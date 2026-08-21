import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import {
  Wind, Clock, CalendarDays,
  Plus, CheckCircle2, AlertTriangle,
  LayoutGrid, Delete, X, Wrench, Loader2, Star,
  History, Timer, Trash2, Film, Music,
  Bell, BellRing, Download, Share, Menu,
  MessageSquare, Send, Eye, LogOut,
  Settings, ChevronRight, Globe,
  ShieldCheck, Repeat, Eraser,
} from "lucide-react";
import * as api from "./api";
import * as push from "./push";
import RoomView from "./Rooms";
import AccessibilityPanel from "./AccessibilityPanel";
import { loadPrefs, savePrefs, applyToDOM, type AccessibilityPrefs } from "./statusConfig";
import type { Role as AdminRole, Tab as AdminTab } from "./AdminPanel";

// Le schermate amministrative vivono dentro questa stessa app, aperte dal menu
// Impostazioni. In lazy perché la stragrande maggioranza di chi apre l'app non
// ha una sessione admin e non deve scaricarne il codice.
const AdminScreens   = lazy(() => import("./AdminPanel").then((m) => ({ default: m.AdminScreens })));
const AdminLoginSheet = lazy(() => import("./AdminPanel").then((m) => ({ default: m.AdminLoginSheet })));

// Le sezioni amministrative sono destinazioni di navigazione come le altre,
// non un pannello a parte: chi ha la sessione le trova nella stessa lista di
// Lavanderia, Cinema e Musica.
type Facility = "laundry" | "cinema" | "music" | AdminTab;

const ADMIN_TABS: AdminTab[] = ["macchine", "segnalazioni", "ricorrenti", "manutenzione"];
const isAdminFacility = (f: Facility): f is AdminTab => (ADMIN_TABS as string[]).includes(f);

/** Etichetta della camera nell'intestazione. Chi amministra è la Direzione. */
const roomLabel = (room: string | null, t: { changeRoom: string }) =>
  room === api.DIREZIONE ? "DIREZIONE" : room ? `St. ${room}` : t.changeRoom;

// Preferenze accessibilità a livello di modulo — lette da tutti i componenti,
// aggiornate da App.handleAccessibilityChange. Evita il prop-drilling profondo.
let accessibilityPrefs: AccessibilityPrefs = loadPrefs();

// ─── Icona lavatrice ───────────────────────────────────────────────────────────
function WashingMachine({ size = 16, style, className }: { size?: number; style?: React.CSSProperties; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={style} className={className} aria-hidden="true">
      <rect width="18" height="20" x="3" y="2" rx="2" />
      <path d="M3 6h18" />
      <path d="M7 4h.01" />
      <path d="M10.5 4h.01" />
      <circle cx="12" cy="14" r="5" />
      <path d="M12 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 1 0-5" />
    </svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type MachineStatus = "available" | "in-use" | "out-of-order";
type MachineType   = "washer" | "dryer";
type Theme         = "dark" | "light";
type Lang          = "it" | "en";

type WeekData   = api.WeekData;
type StatusData = api.StatusData;

interface Machine {
  id: string; label: string; type: MachineType; status: MachineStatus;
  room?: string; prevRoom?: string; prevNudgeSent?: boolean;
}

// ─── Time slots: 19 turni da 75', dalle 07:00 alle 06:45 (scavalca mezzanotte) ─

const N_SLOTS = 19;

function buildSlots() {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (x: number) => { const m = ((x % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
  const out: { start: string; end: string }[] = [];
  let m = 7 * 60;
  for (let i = 0; i < N_SLOTS; i++) { out.push({ start: fmt(m), end: fmt(m + 75) }); m += 75; }
  return out;
}
const TIME_SLOTS = buildSlots();

// Limite "morbido" di prenotazioni per camera a settimana (non bloccante: può andare in negativo)
const WEEKLY_QUOTA = 2;

// Versione app (mostrata in modo discreto nella UI)
const APP_VERSION = "0.4.0";

// ─── "Adesso": giorno e slot correnti calcolati dall'orologio ──────────────────

function nowInfo(d = new Date()) {
  let mins = d.getHours() * 60 + d.getMinutes();
  let shift = 0;
  if (mins < 7 * 60) { shift = -1; mins += 1440; }
  const since7 = mins - 7 * 60;
  let slot = Math.floor(since7 / 75);
  if (slot > N_SLOTS - 1) slot = N_SLOTS - 1;
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate() + shift);
  const dow  = (base.getDay() + 6) % 7;
  const early = (since7 - slot * 75) < 20;
  return { dayIdx: dow, slotIdx: slot, early, base };
}

const _NOW          = nowInfo();
const TODAY_DOW     = _NOW.dayIdx;
const CUR_SLOT      = _NOW.slotIdx;
const PREV_SLOT     = CUR_SLOT - 1;

const MONDAY     = new Date(_NOW.base.getFullYear(), _NOW.base.getMonth(), _NOW.base.getDate() - TODAY_DOW);
const WEEK_DATES = Array.from({ length: 7 }, (_, i) => new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate() + i));
const DAYS_DATE  = WEEK_DATES.map((d) => d.getDate());

const MON_SHORT = {
  it: ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"],
  en: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
} as const;
const monShort = (i: number, lang: Lang) => MON_SHORT[lang][WEEK_DATES[i].getMonth()];

// ─── Colori ────────────────────────────────────────────────────────────────────

const RED    = "var(--primary)";
const RED_FG = "var(--primary-foreground)";
// Le varianti "-text": --status-inuse ecc. sono la palette dichiarata nel
// pannello Accessibilità (dev'essere identica a quel che mostra), mentre
// queste costanti rendono davvero testo e icone di stato nell'app, e devono
// reggere il contrasto WCAG AA nel tema in cui girano. Vedi style.css.
const YELLOW = "var(--status-inuse-text)";
const ORANGE = "var(--status-prev-text)";
const OOS_C  = "var(--status-oos-text)";
const GREEN  = "var(--status-free-text)";

// ─── i18n ─────────────────────────────────────────────────────────────────────

const T = {
  it: {
    greeting: (h: number) => h < 12 ? "Buongiorno" : h < 17 ? "Buon pomeriggio" : "Buonasera",
    fmtTime:  (d: Date) => d.toLocaleTimeString("it-IT", { hour:"2-digit", minute:"2-digit" }),
    fmtDay:   (d: Date) => d.toLocaleDateString("it-IT", { weekday:"long", day:"numeric", month:"long" }),
    days:     ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"],
    room:     "Camera", camera: "camera",
    welcome:  "Einaudi Plus", enterRoom: "Inserisci il numero della tua stanza per accedere",
    installTitle: "Installa Einaudi Plus",
    installBody: "Aggiungila alla schermata Home: si apre come un'app a tutto schermo e può inviarti i promemoria dei turni.",
    installIosBody: "Per installarla su iPhone: tocca il tasto Condividi del browser, poi scegli «Aggiungi a Home».",
    installIosStep: "Condividi  →  Aggiungi a Home",
    installAndroidBody: "Apri il menu del browser e scegli «Aggiungi pagina a → Schermata Home» (o «Installa app»).",
    installAndroidStep: "Menu  →  Aggiungi a Schermata Home",
    installCta: "Installa", installLater: "Più tardi", installIosDone: "Ho capito",
    addFav: "Aggiungi preferito", day: "Giorno", timeSlot: "Fascia oraria", favAlready: "Già nei preferiti",
    chooseWasher: "Scegli la lavatrice", noFreeWashers: "Nessuna lavatrice libera in questo turno.",
    feedback: "Feedback", feedbackBody: "Hai suggerimenti o hai trovato un problema? Scrivici.",
    feedbackPlaceholder: "Scrivi qui il tuo messaggio…", feedbackSend: "Invia", feedbackSending: "Invio feedback…",
    feedbackThanks: "Grazie! Feedback inviato ✓", feedbackError: "Invio non riuscito, riprova.",
    skip:     "Continua senza accedere",
    machines: "Lavatrici", // <--- AGGIUNTO
    washers:  "Lavatrici", dryers: "Asciugatrici", washer: "Lavatrice", dryer: "Asciugatrice",
    free:     "Libera", inUse: "In uso", oos: "Fuori servizio", operative: "Operativa",
    book:     "Prenota", reminder: "Reminder", sendReminder: "Manda reminder", sent: "Inviato ✓",
    bookAnyway:   "Prenota comunque",
    // Attenzione al significato: `is_oos` viene messo dall'amministratore DOPO
    // aver verificato una segnalazione, non dal residente che segnala. Quindi
    // qui il guasto è confermato, non in attesa di conferma.
    oosWarnTitle: "Macchina fuori servizio",
    oosWarnBody:  "L'amministrazione l'ha verificata e segnata come guasta. Puoi prenotarla lo stesso, ma è probabile che non funzioni.",
    oosDryerWarn: (m: string) => `L'asciugatrice ${m} è fuori servizio: potresti dover stendere il bucato.`,
    oosWasherWarn:(m: string) => `La lavatrice ${m} è fuori servizio: potrebbe non partire.`,
    currentSlot: "Turno corrente", prevSlot: "Turno precedente", now: "ora", prev: "prec.",
    yourBookings: "Le tue prenotazioni",
    inProgressNow: "In corso ora",
    noActiveBookings: "Nessuna prenotazione attiva",
    freeTodayLabel: "turni liberi oggi",
    favorites: "Preferiti",
    noFavs: "Tocca la ★ accanto a un orario nella scheda Giornaliero per aggiungerlo ai preferiti.",
    favFree: "Libero", favFull: "Pieno", favPast: "Passato",
    remainingChip: (n: number) => n >= 0 ? `${n} rimast${n === 1 ? "a" : "e"}` : `${-n} in più`,
    slotEndsIn: "Termina tra",
    remainingMsg: (n: number) => n > 0
      ? `Puoi ancora prenotare ${n} ${n === 1 ? "turno" : "turni"} questa settimana (max ${WEEKLY_QUOTA} a camera).`
      : n === 0
      ? `Hai usato entrambi i turni di questa settimana (max ${WEEKLY_QUOTA} a camera).`
      : `Hai superato il limite settimanale di ${WEEKLY_QUOTA} turni (${-n} in più).`,
    altraLavanderia: "Quella camera è dell'altra lavanderia. Puoi prenotare solo le macchine del tuo edificio.",
    noQuota: "senza limite",
    noQuotaMsg: `Il limite di ${WEEKLY_QUOTA} turni vale per camera: alla Direzione non si applica.`,
    howItWorks: "Come funziona",
    autoWash: (_end: string) => `Lavatrice corrispondente prenotata automaticamente per il turno successivo.`,
    daily:    "Giornaliero", weekly: "Settimana", overview: "Panoramica",
    thisWeek: "Settimana corrente",
    confirm:  "Conferma", cancel: "Annulla", modify: "Modifica stanza", delete: "Elimina prenotazione",
    forMe:    (r: string) => `Per me — Camera ${r}`,
    forOther: "Per qualcun altro",
    forDirezione: "Per la Direzione",
    whoIsIt:  "Per chi è la prenotazione?",
    chooseFree: "Scegli una lavatrice libera",
    occupied: "Occupata",
    autoReserved: (lbl: string, t: string) => `Asciugatrice ${lbl} auto-riservata: ${t}`,
    confirmBooking: "Conferma prenotazione",
    slotConfirmed:  "Prenotazione confermata",
    slotUpdated:    "Prenotazione aggiornata",
    slotDeleted:    "Prenotazione eliminata",
    wantModify:     "Vuoi modificare questa prenotazione?",
    bookedBy:       (r: string) => `Prenotata dalla stanza ${r}`,
    machineMgmt:    "Gestione macchine",
    reportOos:      "Segnala un guasto",
    restore:        "Ripristina",
    oosDesc:        "Segnala una macchina che non funziona: un amministratore verifica e la mette fuori servizio.",
    reminderSent:   (r: string) => `Reminder inviato · Stanza ${r}`,
    oosSet:         (lbl: string) => `${lbl} segnalata fuori servizio`,
    oosCleared:     (lbl: string) => `${lbl} ripristinata`,
    reportAction:   "Segnala",
    alreadyOos:     "Già segnalata",
    reportSent:     (lbl: string) => `Guasto segnalato per ${lbl}. Un amministratore verificherà.`,
    booked:         (lbl: string) => `Lavatrice ${lbl} prenotata!`,
    prevHad:        (r: string) => `La stanza ${r} aveva questo turno prima di te — ha già ritirato il bucato?`,
    legendFree:     "Verde — Libera", legendFreeDesc: "Puoi prenotarla subito.",
    legendInUse:    (t: string) => `Giallo — In uso — Turno in corso, fine alle ${t}.`,
    legendPrev:     "Camera — Turno precedente — Indica chi aveva lo slot prima di te.",
    legendOos:      "Rosso — Fuori servizio — Puoi prenotarla comunque, a tuo rischio.",
    legendAuto:     "Asciugatrice automatica — prenotando una lavatrice, quella corrispondente viene riservata per il turno successivo.",
    lgFree: "Libera", lgInUse: "In uso", lgOos: "Fuori servizio", lgPrev: "Turno precedente",
    lgFreeD: "Puoi prenotarla subito.",
    lgInUseD: (t: string) => `Turno in corso, fine alle ${t}.`,
    lgOosD: "Guasto confermato dall'amministrazione. Puoi prenotarla comunque, a tuo rischio.",
    lgPrevD: "La camera che aveva lo slot prima di te.",
    insertRoom:     "Numero di stanza",
    back:           "← Indietro",
    backModify:     "← Modifica",
    changeRoom:     "Cambia camera",
    loading:        "Carico le prenotazioni…",
    retry:          "Riprova",
    netError:       "Impossibile contattare il foglio. Controlla la connessione.",
    taken:          (r?: string) => r ? `Già occupata dalla stanza ${r}` : "Già occupata",
    genericError:   "Errore, riprova.",
  },
  en: {
    greeting: (h: number) => h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening",
    fmtTime:  (d: Date) => d.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" }),
    fmtDay:   (d: Date) => d.toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long" }),
    days:     ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
    room:     "Room", camera: "room",
    welcome:  "Einaudi Plus", enterRoom: "Enter your room number to continue",
    installTitle: "Install Einaudi Plus",
    installBody: "Add it to your Home Screen: it opens like a full-screen app and can send you shift reminders.",
    installIosBody: "To install on iPhone: tap the browser Share button, then choose “Add to Home Screen”.",
    installIosStep: "Share  →  Add to Home Screen",
    installAndroidBody: "Open the browser menu and choose “Add page to → Home screen” (or “Install app”).",
    installAndroidStep: "Menu  →  Add to Home screen",
    installCta: "Install", installLater: "Later", installIosDone: "Got it",
    addFav: "Add favourite", day: "Day", timeSlot: "Time slot", favAlready: "Already a favourite",
    chooseWasher: "Choose a washer", noFreeWashers: "No free washer in this slot.",
    feedback: "Feedback", feedbackBody: "Got suggestions or found a problem? Let us know.",
    feedbackPlaceholder: "Type your message here…", feedbackSend: "Send", feedbackSending: "Sending feedback…",
    feedbackThanks: "Thanks! Feedback sent ✓", feedbackError: "Couldn't send, try again.",
    skip:     "Continue without logging in",
    machines: "Machines", // <--- AGGIUNTO
    washers:  "Washers", dryers: "Dryers", washer: "Washer", dryer: "Dryer",
    free:     "Free", inUse: "In use", oos: "Out of service", operative: "Operational",
    book:     "Book", reminder: "Remind", sendReminder: "Send reminder", sent: "Sent ✓",
    bookAnyway:   "Book anyway",
    oosWarnTitle: "Machine out of service",
    oosWarnBody:  "An admin has checked it and marked it broken. You can still book it, but it probably won't work.",
    oosDryerWarn: (m: string) => `Dryer ${m} is out of service: you may have to hang your laundry.`,
    oosWasherWarn:(m: string) => `Washer ${m} is out of service: it may not start.`,
    currentSlot: "Current slot", prevSlot: "Previous slot", now: "now", prev: "prev.",
    yourBookings: "Your bookings",
    inProgressNow: "In progress now",
    noActiveBookings: "No active bookings",
    freeTodayLabel: "free slots today",
    favorites: "Favourites",
    noFavs: "Tap the ★ next to a time in the Daily tab to add it to favourites.",
    favFree: "Free", favFull: "Full", favPast: "Past",
    remainingChip: (n: number) => n >= 0 ? `${n} left` : `${-n} extra`,
    slotEndsIn: "Ends in",
    remainingMsg: (n: number) => n > 0
      ? `You can book ${n} more ${n === 1 ? "slot" : "slots"} this week (max ${WEEKLY_QUOTA} per room).`
      : n === 0
      ? `You've used both your slots this week (max ${WEEKLY_QUOTA} per room).`
      : `You're over the weekly limit of ${WEEKLY_QUOTA} slots (${-n} extra).`,
    altraLavanderia: "That room belongs to the other laundry. You can only book machines in your own building.",
    noQuota: "no limit",
    noQuotaMsg: `The ${WEEKLY_QUOTA}-slot limit is per room: it doesn't apply to Direzione.`,
    howItWorks: "How it works",
    autoWash: (_end: string) => `Corresponding dryer auto-reserved for the next slot.`,
    daily:    "Daily", weekly: "Week", overview: "Overview",
    thisWeek: "Current week",
    confirm:  "Confirm", cancel:  "Cancel", modify: "Edit room", delete: "Delete booking",
    forMe:    (r: string) => `For me — Room ${r}`,
    forOther: "For someone else",
    forDirezione: "For the front desk",
    whoIsIt:  "Who is this booking for?",
    chooseFree: "Choose a free washer",
    occupied: "Taken",
    autoReserved: (lbl: string, t: string) => `Dryer ${lbl} auto-reserved: ${t}`,
    confirmBooking: "Confirm booking",
    slotConfirmed:  "Booking confirmed",
    slotUpdated:    "Booking updated",
    slotDeleted:    "Booking deleted",
    wantModify:     "Do you want to edit this booking?",
    bookedBy:       (r: string) => `Booked by room ${r}`,
    machineMgmt:    "Machine management",
    reportOos:      "Report a fault",
    restore:        "Restore",
    oosDesc:        "Report a machine that isn't working: an admin will check and mark it out of order.",
    reportAction:   "Report",
    alreadyOos:     "Already reported",
    reportSent:     (lbl: string) => `Fault reported for ${lbl}. An admin will check it.`,
    reminderSent:   (r: string) => `Reminder sent · Room ${r}`,
    oosSet:         (lbl: string) => `${lbl} marked out of order`,
    oosCleared:     (lbl: string) => `${lbl} restored`,
    booked:         (lbl: string) => `Washer ${lbl} booked!`,
    prevHad:        (r: string) => `Room ${r} had this slot before you — have they collected their laundry?`,
    legendFree:     "Green — Free", legendFreeDesc: "Book it now.",
    legendInUse:    (t: string) => `Yellow — In use — Slot ends at ${t}.`,
    legendPrev:     "Room — Previous slot — Shows who had the slot before you.",
    legendOos:      "Red — Out of service — You can still book it, at your own risk.",
    legendAuto:     "Auto-dryer — booking a washer automatically reserves the matching dryer for the next slot.",
    lgFree: "Free", lgInUse: "In use", lgOos: "Out of service", lgPrev: "Previous slot",
    lgFreeD: "Book it now.",
    lgInUseD: (t: string) => `In progress, ends at ${t}.`,
    lgOosD: "Fault confirmed by an admin. You can still book it, at your own risk.",
    lgPrevD: "The room that had the slot before you.",
    insertRoom:     "Room number",
    back:           "← Back",
    backModify:     "← Edit",
    changeRoom:     "Change room",
    loading:        "Loading bookings…",
    retry:          "Retry",
    netError:       "Couldn't reach the sheet. Check your connection.",
    taken:          (r?: string) => r ? `Already taken by room ${r}` : "Already taken",
    genericError:   "Error, try again.",
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtTime = (d: Date, lang: Lang) => T[lang].fmtTime(d);
const fmtDay  = (d: Date, lang: Lang) => T[lang].fmtDay(d);

function slotEndDate(slotIdx: number) {
  const d = new Date(_NOW.base);
  d.setMinutes(d.getMinutes() + 7 * 60 + (slotIdx + 1) * 75);
  return d;
}
function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function errMsg(e: any, lang: Lang) {
  const t = T[lang];
  const msg = String(e?.message ?? e ?? "");
  if (msg.includes("occupata") || msg.toLowerCase().includes("taken")) return t.taken(e?.by);
  if (msg.includes("altra lavanderia")) return t.altraLavanderia;
  return t.genericError;
}

// ─── Derivazione macchine per la Dashboard (slot corrente) ─────────────────────

function bookingAt(week: WeekData, day: number, slot: number, wid: string): string | undefined {
  if (day < 0 || slot < 0) return undefined;
  const v = week?.[day]?.[slot]?.[wid];
  return v ? String(v) : undefined;
}
function prevRef(day: number, slot: number) {
  if (slot > 0) return { day, slot: slot - 1 };
  return { day: (day + 6) % 7, slot: N_SLOTS - 1 };
}
/**
 * Quali macchine esistono fisicamente nella lavanderia di una camera.
 *
 * Unico posto in cui vive questa regola. Prima la stessa condizione
 * (`num > 0 && num < 100`) era ricopiata in sei punti, e infatti erano già
 * divergenti: in uno l'elenco delle asciugatrici della Manica era vuoto.
 *
 * Camere 1-99 → Manica: una lavatrice e un'asciugatrice.
 * Dal 100 in su → Valentino: tre e tre.
 */
export function machinesFor(roomNumber: string | null | undefined): { washers: string[]; dryers: string[] } {
  const num = parseInt(roomNumber?.match(/^(\d+)/)?.[1] || "0", 10);
  const manica = num > 0 && num < 100;
  return manica
    ? { washers: ["W-A"], dryers: ["D-A"] }
    : { washers: ["W-A", "W-B", "W-C"], dryers: ["D-A", "D-B", "D-C"] };
}

function deriveMachines(week: WeekData, status: StatusData, day: number, slot: number, roomNumber: string | null): Machine[] {
  const p  = prevRef(day, slot);
  const pp = prevRef(p.day, p.slot);
  const mk = (id: string, type: MachineType, room?: string, prevRoom?: string): Machine => {
    const st: MachineStatus = status[id] === "oos" ? "out-of-order" : room ? "in-use" : "available";
    return { id, label: id[2], type, status: st, room, prevRoom };
  };
  const out: Machine[] = [];
  const { washers, dryers } = machinesFor(roomNumber);
  const washersList = washers.map((id) => id.slice(2));
  const dryersList  = dryers.map((id) => id.slice(2));

  for (const L of washersList) {
    const wid = "W-" + L;
    out.push(mk(wid, "washer", bookingAt(week, day, slot, wid), bookingAt(week, p.day, p.slot, wid)));
  }
  for (const L of dryersList) {
    const did = "D-" + L, wid = "W-" + L;
    out.push(mk(did, "dryer", bookingAt(week, p.day, p.slot, wid), bookingAt(week, pp.day, pp.slot, wid)));
  }
  return out;
}

// ─── Prenotazioni della propria camera nella settimana ────────────────────────

interface MyBooking { day: number; slot: number; mid: string; }

// Turno preferito: giorno della settimana + slot orario (es. Domenica 14:30–15:45)
interface Fav { day: number; slot: number; }

// I preferiti sono PER CAMERA: chiave separata per ogni stanza, così cambiando
// utente/stanza non restano i preferiti di quella precedente.
const favsKey = (room: string | null) => `laundryhub.favs.${room ?? "_"}`;
function loadFavs(room: string | null): Fav[] {
  if (!room) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(favsKey(room)) || "[]");
    return Array.isArray(raw) ? raw.filter((x: any) => x && typeof x.day === "number" && typeof x.slot === "number") : [];
  } catch { return []; }
}

function myWeekBookings(week: WeekData, room: string): MyBooking[] {
  const out: MyBooking[] = [];
  if (!room) return out;
  for (let day = 0; day < 7; day++) {
    const dd = week[day]; if (!dd) continue;
    for (const slotStr of Object.keys(dd)) {
      const slot = Number(slotStr);
      const slotData = dd[slot]; if (!slotData) continue;
      for (const mid of Object.keys(slotData)) {
        if (mid.startsWith("W-") && slotData[mid] === room) out.push({ day, slot, mid });
      }
    }
  }
  out.sort((a, b) => a.day - b.day || a.slot - b.slot);
  return out;
}

const isPastBooking  = (b: MyBooking) => b.day < TODAY_DOW || (b.day === TODAY_DOW && b.slot < CUR_SLOT);
const isCurrentBooking = (b: MyBooking) => b.day === TODAY_DOW && b.slot === CUR_SLOT;

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-toast-in pointer-events-none">
      <div className="flex items-center gap-2.5 rounded-2xl px-4 py-3 shadow-2xl pointer-events-auto border"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <CheckCircle2 size={14} style={{ color: RED }}/>
        <span className="text-sm font-medium whitespace-nowrap" style={{ color: "var(--foreground)" }}>{msg}</span>
      </div>
    </div>
  );
}

// ─── BookModal (nuova prenotazione / modifica) ────────────────────────────────

interface BookTarget { dayIdx?: number; slotIdx: number; machineId: string; prefillRoom?: string; }

function BookModal({ target, bookings, status = {}, myRoom, lang, isAdmin = false, onConfirm, onClose }: {
  target: BookTarget; bookings: WeekData; status?: StatusData; isDark: boolean;
  myRoom?: string; lang: Lang; isAdmin?: boolean;
  onConfirm: (room: string) => void; onClose: () => void;
}) {
  const t = T[lang];
  const [selMachine, setSelMachine] = useState<string | null>(
    target.machineId !== "?" ? target.machineId : null
  );
  const [room, setRoom] = useState(target.prefillRoom ?? "");
  const firstStep = target.machineId === "?" ? "pick" : myRoom ? "owner" : "input";
  const [step, setStep] = useState<"pick"|"owner"|"input"|"confirm">(firstStep);

  const slot      = TIME_SLOTS[target.slotIdx];
  const dayIdx    = target.dayIdx ?? TODAY_DOW;
  const taken     = new Set(Object.keys(bookings[dayIdx]?.[target.slotIdx] ?? {}));
  
  const bg   = "var(--background)";
  const fg   = "var(--foreground)";
  const sub  = "var(--gray-accessible-text)";
  const chip = "var(--secondary)";
  const machLabel = selMachine?.split("-")[1] ?? "";
  // Chi risulta intestatario del turno: una camera, o la Direzione.
  const intestatario = room === api.DIREZIONE ? "Direzione" : `${t.room} ${room}`;

  // Camera digitata che appartiene all'altro edificio. Si valuta solo a numero
  // completo (>=2 cifre): con una cifra sola "2" sarebbe già "Manica" e
  // l'avviso lampeggerebbe mentre si sta ancora scrivendo "215".
  const altraLavanderia =
    !!myRoom && myRoom !== api.DIREZIONE && room.length >= 2 && !api.sameLaundry(myRoom, room);

  // Prenotando una lavatrice si riserva anche l'asciugatrice con la stessa
  // lettera per il turno successivo: se una delle due è segnalata guasta, chi
  // prenota deve saperlo PRIMA, non scoprirlo davanti alla macchina.
  const oosDi = (id: string) => status[id] === "oos";
  const washerOos = selMachine ? oosDi(selMachine) : false;
  const dryerOos  = selMachine ? oosDi("D-" + selMachine[2]) : false;
  const avviso = washerOos || dryerOos;

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl p-6 pb-8" style={{ background:bg }} onClick={(e)=>e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-xs font-mono mb-0.5" style={{ color:sub }}>{t.days[dayIdx]} {DAYS_DATE[dayIdx]} {monShort(dayIdx, lang)}</p>
            <p className="text-lg font-mono font-bold" style={{ color:fg }}>{slot.start} – {slot.end}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl" style={{ color:sub, background:chip }}><X size={16}/></button>
        </div>

        {/* Avviso guasto: resta visibile per tutti i passaggi successivi alla
            scelta, così non lo si perde passando all'inserimento camera. */}
        {avviso && step !== "pick" && (
          <div className="rounded-2xl p-3.5 mb-5 flex gap-3"
            style={{ background:`color-mix(in srgb, ${OOS_C} 10%, transparent)`, border:`1px solid ${OOS_C}` }}>
            <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color:OOS_C }}/>
            <div className="min-w-0">
              <p className="text-sm font-semibold mb-0.5" style={{ color:OOS_C }}>{t.oosWarnTitle}</p>
              <p className="text-xs leading-snug" style={{ color:fg }}>
                {washerOos && t.oosWasherWarn(machLabel)}
                {washerOos && dryerOos && " "}
                {dryerOos && t.oosDryerWarn(machLabel)}
              </p>
              <p className="text-xs leading-snug mt-1" style={{ color:sub }}>{t.oosWarnBody}</p>
            </div>
          </div>
        )}

        {step === "pick" && (
          <>
            <p className="text-sm font-semibold mb-3" style={{ color:fg }}>{t.chooseFree}</p>
            <div className="flex gap-3 mb-4">
              {machinesFor(myRoom).washers.map((id) => {
                const isTaken = taken.has(id);
                // Guasta la lavatrice, oppure l'asciugatrice che verrebbe
                // riservata insieme: in entrambi i casi va segnalato qui.
                const rotta = oosDi(id) || oosDi("D-" + id[2]);
                return (
                  <button key={id} disabled={isTaken}
                    onClick={() => { setSelMachine(id); setStep("input"); }}
                    className="flex-1 flex flex-col items-center gap-2 rounded-2xl py-4 transition-all active:scale-95 border"
                    style={{
                      background: rotta && !isTaken ? `color-mix(in srgb, ${OOS_C} 8%, transparent)` : chip,
                      borderColor: isTaken ? "transparent" : rotta ? OOS_C : "var(--border)",
                      opacity: isTaken ? 0.32 : 1,
                      cursor: isTaken ? "not-allowed" : "pointer",
                    }}>
                    <WashingMachine size={22} style={{ color:isTaken?sub:rotta?OOS_C:fg }}/>
                    <span className="text-sm font-bold font-mono" style={{ color:isTaken?sub:fg }}>Lav. {id[2]}</span>
                    <span className="text-[10px] flex items-center gap-1"
                      style={{ color: isTaken ? sub : rotta ? OOS_C : GREEN }}>
                      {rotta && !isTaken && <AlertTriangle size={10}/>}
                      {isTaken ? t.occupied : rotta ? t.oos : t.free}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === "owner" && myRoom && (
          <>
            <p className="text-sm font-semibold mb-1" style={{ color:fg }}>{t.whoIsIt}</p>
            <p className="text-xs mb-5" style={{ color:sub }}>Lavatrice {machLabel} · {slot.start} – {slot.end}</p>
            <div className="flex flex-col gap-3 mb-2">
              <button
                onClick={()=>{ setRoom(myRoom); setStep("confirm"); }}
                className="w-full py-4 rounded-2xl text-sm font-semibold flex items-center justify-between px-5 transition-all active:scale-[0.98]"
                style={{ background:RED, color:RED_FG }}>
                {/* La Direzione non è una camera: "Per me — Camera DIREZIONE"
                    non vorrebbe dire niente. */}
                <span>{myRoom === api.DIREZIONE ? t.forDirezione : t.forMe(myRoom)}</span>
                <span style={{ opacity:0.7 }}>→</span>
              </button>
              <button
                onClick={()=>setStep("input")}
                className="w-full py-4 rounded-2xl text-sm font-semibold flex items-center justify-between px-5 transition-all active:scale-[0.98]"
                style={{ background:chip, color:fg }}>
                <span>{t.forOther}</span>
                <span style={{ color:sub }}>→</span>
              </button>
              {/* Visibile solo con una sessione amministrativa, e solo se
                  l'identità corrente non è già la Direzione: altrimenti sarebbe
                  un doppione del pulsante qui sopra. Nasconderlo non e'
                  un'autorizzazione: il server rifiuta comunque senza cookie. */}
              {isAdmin && myRoom !== api.DIREZIONE && (
                <button
                  onClick={()=>{ setRoom(api.DIREZIONE); setStep("confirm"); }}
                  className="w-full py-4 rounded-2xl text-sm font-semibold flex items-center justify-between px-5 transition-all active:scale-[0.98] border"
                  style={{ background:"transparent", borderColor:RED, color:RED }}>
                  <span>{t.forDirezione}</span>
                  <span style={{ opacity:0.7 }}>→</span>
                </button>
              )}
            </div>
          </>
        )}

        {step === "input" && (
          <>
            <p className="text-sm font-semibold mb-4" style={{ color:fg }}>Lavatrice {machLabel} · {t.insertRoom}</p>
            <div className="rounded-2xl px-5 py-4 mb-4 flex items-center justify-between" style={{ background:"var(--muted)" }}>
              <span className="text-sm font-mono" style={{ color:sub }}>{t.room}</span>
              <span className="text-3xl font-mono font-bold tabular-nums" style={{ color:room?fg:sub }}>{room||"—"}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {/* Forma funzionale: due tocchi ravvicinati leggerebbero
                  entrambi lo stesso valore e perderebbero una cifra. */}
              {["1","2","3","4","5","6","7","8","9"].map((k)=>(
                <button key={k} onClick={()=>setRoom(r=>r.length<4?r+k:r)}
                  className="rounded-2xl h-12 text-lg font-bold transition-all active:scale-95"
                  style={{ background:chip, color:fg }}>{k}</button>
              ))}
              <button onClick={()=>setRoom(r=>r.slice(0,-1))}
                className="rounded-2xl h-12 flex items-center justify-center transition-all active:scale-95"
                style={{ background:chip, color:sub }}><Delete size={18}/></button>
              <button onClick={()=>setRoom(r=>r.length<4?r+"0":r)}
                className="rounded-2xl h-12 text-lg font-bold transition-all active:scale-95"
                style={{ background:chip, color:fg }}>0</button>
              <button onClick={()=>room.length>0&&!altraLavanderia&&setStep("confirm")}
                className="rounded-2xl h-12 text-lg font-bold transition-all active:scale-95"
                style={{ background:room.length>0&&!altraLavanderia?RED:chip, color:room.length>0&&!altraLavanderia?RED_FG:sub }}>→</button>
            </div>

            {/* Le due lavanderie sono edifici separati: prenotare una macchina
                dove non si abita non ha senso, e prima corrompeva pure la
                schermata (si finiva a vedere la griglia dell'altro edificio).
                Il rifiuto vero è sul server; qui si dice perché, prima di far
                battere il numero a vuoto. */}
            {altraLavanderia && (
              <p className="text-xs mb-3 px-1 flex items-start gap-1.5" style={{ color:OOS_C }}>
                <AlertTriangle size={13} style={{ flexShrink:0, marginTop:1 }}/>
                {t.altraLavanderia}
              </p>
            )}

            {(target.machineId === "?" || myRoom) && (
              <button onClick={()=>setStep(target.machineId==="?"?"pick":myRoom?"owner":"input")} className="text-xs" style={{ color:sub }}>{t.back}</button>
            )}
          </>
        )}

        {step === "confirm" && (
          <>
            <p className="text-sm font-semibold mb-1" style={{ color:fg }}>{t.confirmBooking}</p>
            {/* "Camera DIREZIONE" non esiste: la Direzione prenota per la
                struttura, non per una stanza. */}
            <p className="text-xs mb-4" style={{ color:sub }}>{intestatario} · Lavatrice {machLabel}</p>
            <div className="rounded-2xl overflow-hidden mb-5 border" style={{ borderColor: "var(--border)" }}>
              <div className="p-4 flex items-center gap-3" style={{ background: "color-mix(in srgb, var(--primary) 12%, transparent)" }}>
                <div className="p-2.5 rounded-xl" style={{ background:RED, color:RED_FG }}><WashingMachine size={18}/></div>
                <div>
                  <p className="text-xs font-mono mb-0.5" style={{ color:sub }}>Lavatrice {machLabel} · {intestatario}</p>
                  <p className="text-base font-mono font-bold" style={{ color:fg }}>{slot.start} – {slot.end}</p>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setStep("input")} className="flex-1 py-3.5 rounded-2xl text-sm font-semibold" style={{ background:chip, color:fg }}>{t.backModify}</button>
              <button onClick={()=>onConfirm(room)} className="flex-1 py-3.5 rounded-2xl text-sm font-semibold" style={{ background:RED, color:RED_FG }}>{t.confirm}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── ModifyModal (modifica/elimina prenotazione esistente) ─────────────────────

interface ModifyTarget { dayIdx: number; slotIdx: number; machineId: string; currentRoom: string; }

function ModifyModal({ target, lang, onEdit, onDelete, onClose }: {
  target: ModifyTarget; isDark: boolean; lang: Lang;
  onEdit: () => void; onDelete: () => void; onClose: () => void;
}) {
  const t    = T[lang];
  const slot = TIME_SLOTS[target.slotIdx];
  const bg   = "var(--background)";
  const fg   = "var(--foreground)";
  const sub  = "var(--gray-accessible-text)";
  const chip = "var(--secondary)";

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl p-6 pb-8" style={{ background:bg }} onClick={(e)=>e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-mono" style={{ color:sub }}>
            {t.days[target.dayIdx]} {DAYS_DATE[target.dayIdx]} {monShort(target.dayIdx, lang)} · Lav. {target.machineId[2]}
          </p>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color:sub, background:chip }}><X size={14}/></button>
        </div>
        <p className="text-lg font-bold mb-1" style={{ color:fg }}>{slot.start} – {slot.end}</p>
        <p className="text-sm mb-6" style={{ color:sub }}>
          {t.bookedBy(target.currentRoom).replace(target.currentRoom, "")}<span style={{ color:fg, fontWeight:600 }}>{target.currentRoom}</span>
        </p>
        <p className="text-xs mb-3" style={{ color:sub }}>{t.wantModify}</p>
        <div className="flex flex-col gap-2">
          <button onClick={onEdit} className="w-full py-3.5 rounded-2xl text-sm font-semibold" style={{ background:RED, color:RED_FG }}>
            {t.modify}
          </button>
          <button onClick={onDelete} className="w-full py-3.5 rounded-2xl text-sm font-semibold" style={{ background: "color-mix(in srgb, var(--destructive) 10%, transparent)", color: OOS_C }}>
            {t.delete}
          </button>
          <button onClick={onClose} className="w-full py-3 rounded-2xl text-sm" style={{ color:sub }}>
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Popup "Aggiungi preferito": scegli giorno + fascia oraria ──────────────────
function FavPicker({ lang, favs, onAdd, onClose }: {
  lang: Lang; favs: Fav[]; onAdd: (day:number, slot:number)=>void; onClose: ()=>void;
}) {
  const t = T[lang];
  const fg="var(--foreground)", sub="var(--gray-accessible-text)", chip="var(--secondary)";
  const [day, setDay]   = useState(TODAY_DOW);
  const [slot, setSlot] = useState(0);
  const already = favs.some((f)=>f.day===day && f.slot===slot);
  return (
    <div className="absolute inset-0 z-50 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pt-5 pb-7 px-6 max-h-[88%] overflow-y-auto" style={{ background:"var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background:"color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        <div className="flex items-center justify-between mb-4">
          <p className="text-lg font-bold" style={{ color:fg }}>{t.addFav}</p>
          <button onClick={onClose} className="p-2 rounded-xl" style={{ background:chip, color:sub }}><X size={16}/></button>
        </div>

        <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.day}</p>
        <div className="grid grid-cols-7 gap-1 mb-4">
          {t.days.map((d, i)=>(
            <button key={i} onClick={()=>setDay(i)} className="py-2 rounded-xl text-xs font-semibold transition-colors"
              style={ i===day ? { background:RED, color:RED_FG } : { background:chip, color:sub } }>{d}</button>
          ))}
        </div>

        <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.timeSlot}</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {TIME_SLOTS.map((s, i)=>(
            <button key={i} onClick={()=>setSlot(i)} className="py-2 rounded-xl text-[11px] font-mono font-semibold transition-colors"
              style={ i===slot ? { background:RED, color:RED_FG } : { background:chip, color:fg } }>{s.start}</button>
          ))}
        </div>

        <button onClick={()=>onAdd(day, slot)} disabled={already}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
          style={{ background:RED, color:RED_FG, opacity: already ? 0.5 : 1 }}>
          <Star size={15}/>{already ? t.favAlready : `${t.addFav} · ${t.days[day]} ${TIME_SLOTS[slot].start}`}
        </button>
      </div>
    </div>
  );
}

// ─── Modale scelta lavatrice (da un turno preferito) ────────────────────────────
function QuickBookModal({ lang, day, slot, week, status, roomNumber, onBook, onClose }: {
  lang: Lang; day: number; slot: number; week: WeekData; status: StatusData; roomNumber: string | null;
  onBook: (day:number, slot:number, mid:string)=>Promise<void>; onClose: ()=>void;
}) {
  const t = T[lang];
  const fg="var(--foreground)", sub="var(--gray-accessible-text)", div="var(--border)", surf="var(--card)";
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const sl = TIME_SLOTS[slot];

  const washers = machinesFor(roomNumber).washers.map((wid) => {
    const L = wid[2];
    const oos = status[wid] === "oos";
    const room = bookingAt(week, day, slot, wid);
    // Guasta ma libera resta prenotabile: chi vuole rischiare può farlo, il
    // banner sotto glielo dice esplicitamente prima che tocchi "Prenota".
    return { L, wid, oos, room, free: !room };
  });
  const anyFree = washers.some((w) => w.free);
  const anyOosFree = washers.some((w) => w.free && w.oos);

  async function book(wid: string) {
    if (busy) return;
    setBusy(wid); setErr(null);
    try { await onBook(day, slot, wid); onClose(); }
    catch (e) { setErr(errMsg(e, lang)); setBusy(null); }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pt-5 pb-7 px-6" style={{ background:"var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background:"color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        <div className="flex items-center justify-between mb-1">
          <p className="text-lg font-bold" style={{ color:fg }}>{t.chooseWasher}</p>
          <button onClick={onClose} className="p-2 rounded-xl" style={{ background:"var(--secondary)", color:sub }}><X size={16}/></button>
        </div>
        <p className="text-sm font-mono mb-4" style={{ color:sub }}>{t.days[day]} · {sl.start}–{sl.end}</p>

        <div className="rounded-2xl overflow-hidden border mb-3" style={{ background:surf, borderColor:div }}>
          {washers.map((w, i) => {
            const dot = w.oos ? OOS_C : w.free ? GREEN : YELLOW;
            const statusText = w.oos ? t.oos : w.free ? t.free : `${t.room} ${w.room}`;
            return (
              <div key={w.L} className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: i < washers.length - 1 ? `1px solid ${div}` : "none" }}>
                <span className="size-2 rounded-full shrink-0" style={{ background:dot }}/>
                <WashingMachine size={17} style={{ color:fg }}/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight" style={{ color:fg }}>{t.washer} {w.L}</p>
                  <p className="text-xs leading-tight truncate" style={{ color: w.oos ? OOS_C : w.free ? GREEN : sub }}>{statusText}</p>
                </div>
                {w.free
                  ? <button onClick={()=>book(w.wid)} disabled={!!busy}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 shrink-0"
                      style={{
                        background: w.oos ? OOS_C : RED,
                        color: w.oos ? "var(--destructive-foreground)" : RED_FG,
                        opacity: busy && busy!==w.wid ? 0.5 : 1,
                      }}>
                      {busy===w.wid ? <Loader2 size={12} className="animate-spin-slow"/>
                        : w.oos ? <AlertTriangle size={12}/> : <Plus size={12}/>}
                      {w.oos ? t.bookAnyway : t.book}
                    </button>
                  : <span className="text-xs font-medium shrink-0" style={{ color:sub }}>{t.favFull}</span>}
              </div>
            );
          })}
        </div>

        {anyOosFree && (
          <p className="text-xs text-center mb-2 flex items-center justify-center gap-1.5" style={{ color:OOS_C }}>
            <AlertTriangle size={12} className="shrink-0"/>{t.oosWarnBody}
          </p>
        )}
        {!anyFree && <p className="text-xs text-center" style={{ color:sub }}>{t.noFreeWashers}</p>}
        {err && <p className="text-xs text-center" style={{ color:OOS_C }}>{err}</p>}
      </div>
    </div>
  );
}

// ─── Modale Feedback ────────────────────────────────────────────────────────────
function FeedbackModal({ lang, room, onClose }: { lang: Lang; room: string | null; onClose: ()=>void }) {
  const t = T[lang];
  const fg="var(--foreground)", sub="var(--gray-accessible-text)", chip="var(--secondary)", div="var(--border)";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err,  setErr]  = useState(false);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(false);
    try { await api.sendFeedback(room, text.trim()); setDone(true); setTimeout(onClose, 1300); }
    catch { setErr(true); setBusy(false); }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pt-5 pb-7 px-6" style={{ background:"var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background:"color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-2xl" style={{ background:`color-mix(in srgb, var(--primary) 15%, transparent)`, color:RED }}><MessageSquare size={18}/></div>
          <p className="text-lg font-bold" style={{ color:fg }}>{t.feedback}</p>
        </div>
        {done ? (
          <p className="text-sm py-6 text-center font-medium" style={{ color:GREEN }}>{t.feedbackThanks}</p>
        ) : (
          <>
            <p className="text-sm mb-3" style={{ color:sub }}>{t.feedbackBody}</p>
            <textarea value={text} onChange={(e)=>setText(e.target.value)} rows={4} placeholder={t.feedbackPlaceholder}
              className="w-full rounded-2xl px-3 py-2.5 text-sm outline-none mb-2 resize-none"
              style={{ background:chip, color:fg, border:`1px solid ${div}` }}/>
            {err && <p className="text-xs mb-2" style={{ color:OOS_C }}>{t.feedbackError}</p>}
            <button onClick={send} disabled={!text.trim() || busy}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
              style={{ background:RED, color:RED_FG, opacity:(!text.trim() || busy) ? 0.5 : 1 }}>
              <Send size={15}/>{busy ? t.feedbackSending : t.feedbackSend}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ lang, week, status, roomNumber, favs, onToggleFav, onBook, onClear, onStatus, isAdmin }: {
  theme: Theme; lang: Lang; week: WeekData; status: StatusData; roomNumber: string;
  favs: Fav[]; onToggleFav: (day:number, slot:number)=>void;
  onBook: (day:number, slot:number, machine:string, room:string)=>Promise<void>;
  onClear: (day:number, slot:number, machine:string)=>Promise<void>;
  onStatus: (machine:string, oos:boolean)=>Promise<void>;
  isAdmin: boolean;
}) {
  const t = T[lang];
  const [now, setNow]           = useState(new Date());
  const [toast, setToast]       = useState<string | null>(null);
  const [booking, setBooking]   = useState<Machine | null>(null);
  const [segnalaOpen, setSegnalaOpen] = useState(false);
  const [favPicker, setFavPicker] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [quickTarget, setQuickTarget] = useState<{ day:number; slot:number } | null>(null);

  const fg   = "var(--foreground)";
  const sub  = "var(--gray-accessible-text)";
  const surf = "var(--card)";
  const div  = "var(--border)";

  useEffect(() => {
    const id = setInterval(() => {
      const n = new Date();
      setNow(n);
      if (slotEndDate(CUR_SLOT).getTime() - n.getTime() <= 0) {
        window.location.reload();
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const machines = deriveMachines(week, status, TODAY_DOW, CUR_SLOT, roomNumber);

  async function confirmBooking(m: Machine, room: string) {
    try { await onBook(TODAY_DOW, CUR_SLOT, m.id, room); setBooking(null); setToast(t.booked(m.label)); }
    catch (e) { setBooking(null); setToast(errMsg(e, lang)); }
  }

  const slot       = TIME_SLOTS[CUR_SLOT];
  const slotEndsMs = slotEndDate(CUR_SLOT).getTime() - now.getTime();
  
  const myBookings     = myWeekBookings(week, roomNumber);
  // La quota è "per camera": la Direzione non è una camera e il server non
  // gliela applica (book_as_direzione non la controlla, di proposito). Senza
  // questa eccezione il conteggio lato client avrebbe detto "0 rimaste" alla
  // terza prenotazione della portineria, che invece sarebbe passata.
  const senzaQuota     = roomNumber === api.DIREZIONE;
  const remaining      = senzaQuota ? Infinity : WEEKLY_QUOTA - myBookings.length;
  const activeBookings = myBookings.filter((b) => !isPastBooking(b));

  // Prima lavatrice libera in un dato (giorno, slot)
  const firstFreeWasherAt = (day: number, s: number): string | null => {
    const washIds = machinesFor(roomNumber).washers;
    return washIds.find((wid) => status[wid] !== "oos" && !week[day]?.[s]?.[wid]) ?? null;
  };

  // Prenota una lavatrice scelta a mano (dal modale dei preferiti).
  // Rilancia l'errore così il modale resta aperto e lo mostra.
  async function quickBook(day: number, s: number, mid: string) {
    if (!roomNumber) return;
    await onBook(day, s, mid, roomNumber);
    setToast(t.booked(mid[2]));
  }

  async function cancelBooking(b: MyBooking) {
    try { await onClear(b.day, b.slot, b.mid); setToast(t.slotDeleted); }
    catch (e) { setToast(errMsg(e, lang)); }
  }

  // Mostriamo lavatrici e asciugatrici in due gruppi separati (A/B/C ciascuno):
  // la lavatrice è prenotabile; l'asciugatrice è in sola lettura (auto-riservata
  // dal backend col turno successivo) e mostra occupante attuale e precedente.
  const washers = machines.filter((m) => m.type === "washer");
  const dryers  = machines.filter((m) => m.type === "dryer");

  return (
    <div className="flex flex-col pb-6">
      {toast     && <Toast msg={toast} onClose={()=>setToast(null)}/>}
      {segnalaOpen && <SegnalaGuastoSheet lang={lang} status={status} onStatus={onStatus} onClose={()=>setSegnalaOpen(false)} roomNumber={roomNumber}/>}
      {booking && (
        <BookModal
          target={{ slotIdx:CUR_SLOT, machineId:booking.id }}
          bookings={week}
          status={status}
          isDark={false}
          lang={lang}
          myRoom={roomNumber}
          isAdmin={isAdmin}
          onConfirm={(r)=>confirmBooking(booking,r)}
          onClose={()=>setBooking(null)}
        />
      )}
      {favPicker && (
        <FavPicker lang={lang} favs={favs} onClose={()=>setFavPicker(false)}
          onAdd={(d, s)=>{ if (!favs.some((f)=>f.day===d && f.slot===s)) onToggleFav(d, s); setFavPicker(false); }}/>
      )}
      {feedbackOpen && <FeedbackModal lang={lang} room={roomNumber} onClose={()=>setFeedbackOpen(false)}/>}
      {quickTarget && (
        <QuickBookModal lang={lang} day={quickTarget.day} slot={quickTarget.slot}
          week={week} status={status} roomNumber={roomNumber} onBook={quickBook}
          onClose={()=>setQuickTarget(null)}/>
      )}

      {/* Header */}
      <div className="px-5 pt-6 pb-5">
        <div className="text-center mb-4">
          <p className="text-[11px] font-mono tracking-widest uppercase mb-1.5" style={{ color:sub }}>{fmtDay(now, lang)}</p>
          <p className="text-4xl font-bold tabular-nums font-mono leading-none mb-1.5" style={{ color:fg }}>{fmtTime(now, lang)}</p>
          <p className="text-sm" style={{ color:sub }}>
            {/* "camera DIREZIONE" non vuol dire niente: la direzione non è una
                camera, è chi prenota per conto della struttura. */}
            {t.greeting(now.getHours())}
            {roomNumber === api.DIREZIONE
              ? <>, <span style={{ color:fg, fontWeight:600 }}>Direzione</span></>
              : roomNumber ? <>, {t.camera} <span style={{ color:fg, fontWeight:600 }}>{roomNumber}</span></> : ""}
          </p>
        </div>

        {/* Turno corrente */}
        <div className="rounded-2xl border px-5 py-4 flex items-center justify-between gap-4"
          style={{ background: "color-mix(in srgb, var(--primary) 10%, transparent)", borderColor: "color-mix(in srgb, var(--primary) 30%, transparent)" }}>
          <div className="min-w-0">
            <p className="text-[11px] font-mono tracking-widest uppercase mb-1 flex items-center gap-1.5" style={{ color:RED }}>
              <span className="size-2 rounded-full animate-pulse shrink-0" style={{ background:RED }}/>
              {t.currentSlot}
            </p>
            <p className="text-2xl font-mono font-bold leading-none" style={{ color:fg }}>{slot.start}–{slot.end}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] font-mono tracking-widest uppercase mb-1 flex items-center justify-end gap-1" style={{ color:sub }}>
              <Timer size={11}/>{t.slotEndsIn}
            </p>
            <p className="text-2xl font-mono font-bold tabular-nums leading-none" style={{ color:RED }}>{fmtCountdown(slotEndsMs)}</p>
          </div>
        </div>
      </div>

      <div className="md:grid md:grid-cols-2 md:gap-x-5 md:items-start">
      <div className="md:flex md:flex-col">

      {/* Le tue prenotazioni */}
      {roomNumber && (
        <section className="px-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-mono tracking-widest uppercase" style={{ color:sub }}>{t.yourBookings}</p>
            <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-full"
              style={{
                background: senzaQuota || remaining > 0 ? `color-mix(in srgb, ${GREEN} 15%, transparent)`
                          : remaining === 0 ? "var(--secondary)"
                          : `color-mix(in srgb, ${ORANGE} 18%, transparent)`,
                color: senzaQuota || remaining > 0 ? GREEN : remaining === 0 ? sub : ORANGE,
              }}>
              {senzaQuota ? t.noQuota : t.remainingChip(remaining)}
            </span>
          </div>
          <div className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
            {activeBookings.length === 0 ? (
              <div className="px-4 py-3">
                <p className="text-xs" style={{ color:sub }}>{t.noActiveBookings}</p>
              </div>
            ) : (
              activeBookings.map((b, i) => {
                const cur = isCurrentBooking(b);
                const s   = TIME_SLOTS[b.slot];
                return (
                  <div key={`${b.day}-${b.slot}-${b.mid}`} className="flex items-center gap-3 px-4 py-3"
                    style={{ borderBottom: i < activeBookings.length - 1 ? `1px solid ${div}` : "none",
                             background: cur ? `color-mix(in srgb, var(--primary) 8%, transparent)` : "transparent" }}>
                    <div className="p-2 rounded-xl shrink-0"
                      style={{ background: cur ? RED : `color-mix(in srgb, var(--primary) 15%, transparent)`, color: cur ? RED_FG : RED }}>
                      <WashingMachine size={15}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color:fg }}>Lav. {b.mid[2]} · {s.start}–{s.end}</p>
                      <p className="text-[11px] font-mono" style={{ color: cur ? RED : sub }}>
                        {cur ? t.inProgressNow : `${t.days[b.day]} ${DAYS_DATE[b.day]} ${monShort(b.day, lang)}`}
                      </p>
                    </div>
                    {cur && <span className="size-2 rounded-full animate-pulse shrink-0" style={{ background:RED }}/>}
                    <button onClick={()=>cancelBooking(b)} aria-label={t.delete}
                      className="p-2 rounded-lg shrink-0 transition-all active:scale-90"
                      style={{ background:`color-mix(in srgb, var(--destructive) 10%, transparent)`, color:OOS_C }}>
                      <Trash2 size={14}/>
                    </button>
                  </div>
                );
              })
            )}
            <div className="flex items-center gap-2 px-4 py-2.5 border-t"
              style={{ borderColor:div, background: `color-mix(in srgb, var(--primary) 4%, transparent)` }}>
              <CalendarDays size={12} style={{ color: senzaQuota || remaining >= 0 ? sub : ORANGE, flexShrink:0 }}/>
              <p className="text-[11px]" style={{ color: senzaQuota || remaining >= 0 ? sub : ORANGE }}>
                {senzaQuota ? t.noQuotaMsg : t.remainingMsg(remaining)}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Turni liberi oggi 
      <section className="px-5 mb-4">
        <div className="rounded-2xl border flex items-center gap-3 px-4 py-3.5" style={{ background:surf, borderColor:div }}>
          <div className="p-2 rounded-xl shrink-0" style={{ background:`color-mix(in srgb, ${GREEN} 15%, transparent)`, color:GREEN }}>
            <LayoutGrid size={16}/>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums" style={{ color:fg }}>{freeTodaySlots}</span>
            <span className="text-xs" style={{ color:sub }}>{t.freeTodayLabel}</span>
          </div>
        </div>
      </section>
      */}
      {/* Preferiti */}
      <section className="px-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-mono tracking-widest uppercase" style={{ color:sub }}>{t.favorites}</p>
          <button onClick={()=>setFavPicker(true)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-all active:scale-95"
            style={{ background:`color-mix(in srgb, var(--primary) 12%, transparent)`, color:RED }}>
            <Plus size={12}/>{t.addFav}
          </button>
        </div>
        <div className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
          {favs.length === 0 ? (
            <div className="flex items-start gap-3 px-4 py-3">
              <Star size={14} style={{ color:ORANGE, marginTop:1, flexShrink:0 }}/>
              <p className="text-xs" style={{ color:sub }}>{t.noFavs}</p>
            </div>
          ) : (
            favs.map((f, i) => {
              const sl      = TIME_SLOTS[f.slot];
              const past    = isPastBooking({ day: f.day, slot: f.slot, mid: "W-A" });
              const freeMid = past ? null : firstFreeWasherAt(f.day, f.slot);
              return (
                <div key={`${f.day}-${f.slot}`} className="flex items-center gap-3 px-4 py-3"
                  style={{ borderBottom: i < favs.length - 1 ? `1px solid ${div}` : "none" }}>
                  <Star size={14} style={{ color:ORANGE, fill:ORANGE, flexShrink:0 }}/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono font-semibold" style={{ color:fg }}>
                      {t.days[f.day]} · {sl.start}–{sl.end}
                    </p>
                    <p className="text-[11px]" style={{ color: past ? sub : freeMid ? GREEN : sub }}>
                      {past ? t.favPast : freeMid ? t.favFree : t.favFull}
                    </p>
                  </div>
                  {!past && roomNumber && (
                    <button onClick={()=>setQuickTarget({ day:f.day, slot:f.slot })}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 shrink-0"
                      style={ freeMid
                        ? { background:`color-mix(in srgb, ${GREEN} 18%, transparent)`, color:GREEN }
                        : { background:"var(--secondary)", color:sub } }>
                      <Plus size={12}/>{t.book}
                    </button>
                  )}
                  <button onClick={()=>onToggleFav(f.day, f.slot)} className="p-1.5 rounded-lg shrink-0 transition-colors" style={{ color:sub }} aria-label="rimuovi">
                    <X size={13}/>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>

      </div>{/* ── fine colonna 1 (personale) ── */}

      <div className="md:flex md:flex-col">

      {/* Macchine raggruppate per lettera: A (lavatrice + asciugatrice), B, C */}
      <section className="px-5 mb-4">
        <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.machines}</p>
        <div className="flex flex-col gap-3">
          {machinesFor(roomNumber).washers.map((id) => id[2]).map((L) => {
            const wm = washers.find((m) => m.label === L);
            const dm = dryers.find((m) => m.label === L);
            return (
              <div key={L} className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
                <div className="px-4 py-2 flex items-center gap-2 border-b"
                  style={{ borderColor:div, background:"var(--card)" }}>
                  <span className="size-1.5 rounded-full" style={{ background:RED }}/>
                  <span className="text-xs font-mono font-bold tracking-[0.2em]" style={{ color:fg }}>{L}</span>
                </div>
                {wm && <MachineRow key={wm.id} machine={wm} lang={lang} groupLabel={t.washer}
                  isLast={false} divColor={div} onBook={() => setBooking(wm)}/>}
                {dm && <MachineRow key={dm.id} machine={dm} lang={lang} groupLabel={t.dryer}
                  isLast divColor={div} onBook={() => {}}/>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Legenda */}
      <section className="px-5 pt-2">
        <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.howItWorks}</p>
        <div className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
          {[
            { dot:GREEN,  statusKey:"free" as const,  name:t.lgFree,  desc:t.lgFreeD },
            { dot:YELLOW, statusKey:"inuse" as const, name:t.lgInUse, desc:t.lgInUseD(TIME_SLOTS[CUR_SLOT].end) },
            { dot:OOS_C,  statusKey:"oos" as const,   name:t.lgOos,   desc:t.lgOosD },
            { icon:true,  statusKey:undefined,         name:t.lgPrev,  desc:t.lgPrevD },
          ].map(({ dot, icon, statusKey, name, desc }, i, arr) => (
            <div key={name} className="px-4 py-3"
              style={{ borderBottom: i < arr.length - 1 ? `1px solid ${div}` : "none" }}>
              {/* Colore/icona + nome stato sopra */}
              <div className="flex items-center gap-2 mb-1">
                {icon
                  ? <History size={13} className="shrink-0" style={{ color:ORANGE }}/>
                  : statusKey && accessibilityPrefs.icons[statusKey] !== "●"
                    ? <span className="shrink-0 text-[13px] leading-none" style={{ color:dot }}>{accessibilityPrefs.icons[statusKey]}</span>
                    : <span className="size-2.5 rounded-full shrink-0" style={{ background:dot }}/>}
                <p className="text-xs font-semibold" style={{ color: fg }}>{name}</p>
              </div>
              {/* Spiegazione in grigio chiaro, sotto al colore */}
              <p className="text-xs" style={{ color: "color-mix(in srgb, var(--foreground) 50%, transparent)" }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Admin + Feedback */}
      <div className="px-5 pt-3 pb-1 flex flex-col gap-2">
        <button
          onClick={() => setSegnalaOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-medium transition-all active:scale-[0.98] border"
          style={{ background: "var(--secondary)", color:sub, borderColor: "var(--border)" }}>
          <Wrench size={14}/>
          {t.reportOos}
        </button>
        <button
          onClick={() => setFeedbackOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-medium transition-all active:scale-[0.98] border"
          style={{ background: "var(--secondary)", color:sub, borderColor: "var(--border)" }}>
          <MessageSquare size={14}/>
          {t.feedback}
        </button>
      </div>

      </div>{/* ── fine colonna 2 (macchine) ── */}
      </div>{/* ── fine griglia desktop ── */}

      {/* Versione */}
      <p className="text-center text-[10px] font-mono mt-4" style={{ color: sub }}>v. {APP_VERSION} (beta)</p>
    </div>
  );
}

function MachineRow({ machine, lang, isLast, divColor, onBook, groupLabel }: {
  machine: Machine; lang: Lang; isLast: boolean; divColor: string; onBook:()=>void; groupLabel?: string;
}) {
  const t = T[lang];
  const fg  = "var(--foreground)";

  const isFree  = machine.status === "available";
  const isOOO   = machine.status === "out-of-order";

  const dotColor = isOOO ? OOS_C : isFree ? GREEN : YELLOW;
  const rowBg = isFree ? `color-mix(in srgb, ${GREEN} 6%, transparent)` : "transparent";

  // Fuori servizio e occupata sono due fatti indipendenti, e prima il primo
  // nascondeva il secondo: una macchina guasta ma gia' prenotata risultava
  // solo "Fuori servizio", senza pulsante, e sembrava libera con un comando
  // mancante. Ora si dicono entrambi.
  const statusText = isOOO
    ? (machine.room ? `${t.oos} · ${t.room} ${machine.room}` : t.oos)
    : isFree ? t.free : `${t.room} ${machine.room}`;
  const statusColor = isFree ? GREEN : isOOO ? OOS_C : fg;

  // Prenotabile: e' una lavatrice e nessuno l'ha ancora presa. Che sia guasta
  // non toglie il diritto di prenotarla, cambia solo il colore del pulsante.
  const canBook = machine.type === "washer" && !machine.room;

  return (
    <div style={{ borderBottom:isLast?"none":`1px solid ${divColor}`, background:rowBg }}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Dot/icona stato + icona macchina */}
        <div className="flex items-center gap-2.5 shrink-0">
          {(() => {
            const sk = isOOO ? "oos" : isFree ? "free" : "inuse";
            const ci = accessibilityPrefs.icons[sk as "free"|"inuse"|"oos"];
            return ci !== "●"
              ? <span className="shrink-0 text-[11px] leading-none" style={{ color:dotColor }}>{ci}</span>
              : <span className="size-2 rounded-full shrink-0" style={{ background:dotColor }}/>;
          })()}
          {machine.type==="washer" ? <WashingMachine size={18}/> : <Wind size={17}/>}
        </div>

        {/* Etichetta + stato, impilati (così non si accavallano su mobile) */}
        <div className="flex-1 min-w-0">
          {groupLabel
            ? <p className="text-sm font-semibold leading-tight truncate" style={{ color:fg }}>{groupLabel}</p>
            : <p className="text-base font-mono font-bold leading-tight" style={{ color:fg }}>{machine.label}</p>}
          <p className="text-xs font-medium leading-tight truncate" style={{ color:statusColor }}>{statusText}</p>
        </div>

        {/* Azioni */}
        <div className="flex items-center gap-2 shrink-0">
          {machine.prevRoom && (
            <span className="flex items-center gap-1 rounded-xl px-2 py-1.5"
              style={{ background:`color-mix(in srgb, ${ORANGE} 12%, transparent)`, color:ORANGE }}
              title={`${t.lgPrev}: ${machine.prevRoom}`}>
              <History size={13} className="shrink-0"/>
              <span className="text-[11px] font-mono font-semibold">{machine.prevRoom}</span>
            </span>
          )}
          {/* Il pulsante resta anche quando la macchina è guasta: cambia solo
              colore ed etichetta. Rosso perché non è l'azione consigliata, ma
              la scelta spetta a chi prenota — a volte la macchina funziona
              lo stesso, o si preferisce tenere il turno. */}
          {canBook && (
            <button onClick={onBook}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold shrink-0 transition-all active:scale-95"
              style={isOOO
                ? { background:OOS_C, color:"var(--destructive-foreground)" }
                : { background:`color-mix(in srgb, ${GREEN} 18%, transparent)`, color:GREEN }}>
              {isOOO ? <AlertTriangle size={12}/> : <Plus size={12}/>}
              {isOOO ? t.bookAnyway : t.book}
            </button>
          )}
          {/* Guasta e non prenotabile (asciugatrice, o gia' occupata):
              resta il triangolo come promemoria visivo. */}
          {isOOO && !canBook && <AlertTriangle size={15} style={{ color:OOS_C }}/>}
        </div>
      </div>
    </div>
  );
}

// ─── Day Schedule ──────────────────────────────────────────────────────────────

function DaySchedule({ lang, week, status, roomNumber: sessionRoom, favs, onToggleFav, onBook, onClear, isAdmin }: {
  theme: Theme; lang: Lang; week: WeekData; status: StatusData; roomNumber: string;
  favs: Fav[]; onToggleFav: (day:number, slot:number)=>void;
  onBook: (day:number, slot:number, machine:string, room:string)=>Promise<void>;
  onClear: (day:number, slot:number, machine:string)=>Promise<void>;
  isAdmin: boolean;
}) {
  const t = T[lang];
  const [selDay, setSelDay]       = useState(TODAY_DOW);
  const [target, setTarget]       = useState<BookTarget | null>(null);
  const [modTarget, setModTarget] = useState<ModifyTarget | null>(null);
  const [toast, setToast]         = useState<string | null>(null);

  const fg  = "var(--foreground)";
  const sub = "var(--gray-accessible-text)";
  const hdr = "var(--muted)";
  const div = "var(--border)";
  const dayData = week[selDay] ?? {};

  const washIds = machinesFor(sessionRoom).washers;

  async function confirmBooking(room: string) {
    if (!target) return;
    const ti = target;
    setTarget(null);
    try {
      if (week[selDay]?.[ti.slotIdx]?.[ti.machineId]) await onClear(selDay, ti.slotIdx, ti.machineId);
      await onBook(selDay, ti.slotIdx, ti.machineId, room);
      setToast(`${t.slotConfirmed} · ${TIME_SLOTS[ti.slotIdx].start}`);
    } catch (e) { setToast(errMsg(e, lang)); }
  }

  async function deleteBooking() {
    if (!modTarget) return;
    const mt = modTarget;
    setModTarget(null);
    try { await onClear(mt.dayIdx, mt.slotIdx, mt.machineId); setToast(t.slotDeleted); }
    catch (e) { setToast(errMsg(e, lang)); }
  }

  // Piu' largo di prima (era 3xl, 768px) ma non a tutta pagina: qui le colonne
  // sono solo le lavatrici, e oltre un certo punto diventano bande vuote.
  return (
    <div className="flex flex-col h-full lg:max-w-5xl lg:mx-auto lg:w-full">
      {toast     && <Toast msg={toast} onClose={()=>setToast(null)}/>}
      {target    && <BookModal target={{...target,dayIdx:selDay}} bookings={week} status={status} isDark={false} lang={lang} myRoom={sessionRoom} isAdmin={isAdmin} onConfirm={confirmBooking} onClose={()=>setTarget(null)}/>}
      {modTarget && (
        <ModifyModal
          target={modTarget} isDark={false} lang={lang}
          onEdit={()=>{ setTarget({ slotIdx:modTarget.slotIdx, machineId:modTarget.machineId, dayIdx:modTarget.dayIdx, prefillRoom:modTarget.currentRoom }); setModTarget(null); }}
          onDelete={deleteBooking}
          onClose={()=>setModTarget(null)}
        />
      )}

      <div className="px-5 pt-3 pb-2 shrink-0">
        <h2 className="text-base font-bold mb-2" style={{ color:fg }}>{t.daily}</h2>
        <div className="grid grid-cols-7 gap-1">
          {t.days.map((d, i) => {
            const isActive = i===selDay;
            const isPast   = i<TODAY_DOW;
            return (
              <button key={d} onClick={()=>setSelDay(i)}
                className="flex flex-col items-center py-1.5 rounded-xl transition-colors"
                style={{ background:isActive?RED:"transparent", color:isActive?RED_FG:isPast?"color-mix(in srgb, var(--muted-foreground) 40%, transparent)":sub }}>
                <span className="text-[9px] font-mono uppercase leading-none mb-0.5">{d}</span>
                <span className="text-sm font-bold leading-none">{DAYS_DATE[i]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center px-5 py-2 border-b shrink-0" style={{ background:hdr, borderColor:div }}>
        <div className="w-[56px] shrink-0"/>
        {washIds.map((id)=>(
          <div key={id} className="flex-1 flex flex-col items-center gap-0.5">
            <WashingMachine size={11} style={{ color:sub }}/>
            <span className="text-[9px] font-mono" style={{ color:sub }}>Lav. {id[2]}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {TIME_SLOTS.map((slot, si) => {
          const isCur  = si===CUR_SLOT  && selDay===TODAY_DOW;
          const isPrev = si===PREV_SLOT && selDay===TODAY_DOW;
          const isPast = selDay<TODAY_DOW || (selDay===TODAY_DOW && si<CUR_SLOT);
          const isFav  = favs.some((f) => f.day === selDay && f.slot === si);
          return (
            <div key={slot.start} className="flex items-center px-5 relative"
              style={{ minHeight:48, background:isCur?`color-mix(in srgb, var(--primary) 8%, transparent)`:isPrev?`color-mix(in srgb, var(--chart-4) 5%, transparent)`:"transparent", borderBottom:`1px solid ${div}` }}>
              {isCur  && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background:RED }}/>}
              {isPrev && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background:ORANGE }}/>}
              <div className="w-[56px] shrink-0 py-2 flex items-start gap-1">
                <div className="min-w-0">
                  <span className="text-[10px] font-mono tabular-nums block" style={{ color:isCur?RED:isPrev?ORANGE:sub }}>{slot.start}</span>
                  {isCur  && <span className="text-[8px] font-mono" style={{ color:RED }}>{t.now}</span>}
                  {isPrev && <span className="text-[8px] font-mono" style={{ color:ORANGE }}>{t.prev}</span>}
                </div>
                <button onClick={()=>onToggleFav(selDay, si)} className="p-0.5 -mr-1 shrink-0 transition-transform active:scale-90" aria-label="preferito">
                  <Star size={11} style={{ color:isFav?ORANGE:sub, fill:isFav?ORANGE:"none", opacity:isFav?1:0.45 }}/>
                </button>
              </div>
              {washIds.map((mid) => {
                const room = dayData[si]?.[mid];
                const isMe = !!sessionRoom && room === sessionRoom;
                return (
                  <div key={mid} className="flex-1 px-1 py-1.5">
                    {room ? (
                      <button
                        onClick={()=>!isPast && setModTarget({ dayIdx:selDay, slotIdx:si, machineId:mid, currentRoom:room })}
                        className="w-full h-9 rounded-xl flex items-center justify-center transition-all active:scale-95"
                        style={{
                          background: isMe ? RED : "var(--secondary)",
                          border: `1px solid ${isMe ? RED : "var(--border)"}`,
                          boxShadow: isMe ? "0 2px 8px color-mix(in srgb, var(--primary) 35%, transparent)" : "none",
                          cursor:isPast?"default":"pointer"
                        }}>
                        <span className="text-[10px] font-mono font-bold" style={{ color:isMe?RED_FG:sub }}>{room}</span>
                      </button>
                    ) : (
                      <button disabled={isPast}
                        onClick={()=>!isPast && setTarget({ slotIdx:si, machineId:mid })}
                        className="w-full h-9 rounded-xl flex items-center justify-center transition-colors border"
                        style={{ borderColor:"var(--border)", borderStyle:"dashed", background:"transparent", cursor:isPast?"default":"pointer" }}>
                        {!isPast && <Plus size={10} style={{ color:"var(--gray-accessible-text)", opacity:0.6 }}/>}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Slot detail sheet (vista settimanale) ────────────────────────────────────

interface SlotDetailTarget { dayIdx: number; slotIdx: number; }

function SlotDetailSheet({ target, bookings, lang, roomNumber, onBook, onModify, onDelete, onClose }: {
  target: SlotDetailTarget;
  bookings: WeekData;
  isDark: boolean;
  lang: Lang;
  roomNumber: string | null;
  onBook: (machineId: string) => void;
  onModify: (machineId: string, currentRoom: string) => void;
  onDelete: (machineId: string) => void;
  onClose: () => void;
}) {
  const t        = T[lang];
  const slot     = TIME_SLOTS[target.slotIdx];
  const slotData = bookings[target.dayIdx]?.[target.slotIdx] ?? {};
  
  const bg       = "var(--background)";
  const fg       = "var(--foreground)";
  const sub      = "var(--gray-accessible-text)";
  const chip     = "var(--secondary)";
  const divC     = "var(--border)";

  const washIds = machinesFor(roomNumber).washers;

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pb-8" style={{ background:bg }} onClick={(e)=>e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 border-b" style={{ borderColor:divC }}>
          <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-mono mb-0.5" style={{ color:sub }}>
                {t.days[target.dayIdx]} {DAYS_DATE[target.dayIdx]} {monShort(target.dayIdx, lang)}
              </p>
              <p className="text-xl font-mono font-bold" style={{ color:fg }}>{slot.start} – {slot.end}</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl" style={{ color:sub, background:chip }}>
              <X size={16}/>
            </button>
          </div>
        </div>

        <div className="px-6 pt-4 flex flex-col gap-2.5">
          {washIds.map((mid) => {
            const room = slotData[mid];
            const lbl  = mid[2];
            return (
              <div key={mid} className="rounded-2xl px-4 py-3.5 border"
                style={{ background:chip, borderColor:divC }}>
                <div className="flex items-center gap-3">
                  <WashingMachine size={18} style={{ color:room?fg:sub, flexShrink:0 }}/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color:fg }}>Lavatrice {lbl}</p>
                    <p className="text-xs font-mono" style={{ color:room?sub:GREEN }}>
                      {room ? `${t.room} ${room}` : t.free}
                    </p>
                  </div>
                  {!room && (
                    <button
                      onClick={()=>onBook(mid)}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 shrink-0"
                      style={{ background:`color-mix(in srgb, ${GREEN} 12%, transparent)`, color:GREEN }}>
                      <Plus size={11}/>{t.book}
                    </button>
                  )}
                </div>
                {room && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={()=>onModify(mid, room)}
                      className="flex-1 rounded-xl py-2 text-xs font-semibold transition-all active:scale-95"
                      style={{ background:`color-mix(in srgb, var(--primary) 15%, transparent)`, color:RED }}>
                      {t.modify}
                    </button>
                    <button
                      onClick={()=>onDelete(mid)}
                      className="flex-1 rounded-xl py-2 text-xs font-semibold transition-all active:scale-95 border"
                      style={{ background:"transparent", borderColor:"var(--border)", color:OOS_C }}>
                      {t.delete}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Week Overview ─────────────────────────────────────────────────────────────

function WeekOverview({ lang, week, status, roomNumber: sessionRoom, onBook, onClear, isAdmin }: {
  theme: Theme; lang: Lang; week: WeekData; status: StatusData; roomNumber: string;
  onBook: (day:number, slot:number, machine:string, room:string)=>Promise<void>;
  onClear: (day:number, slot:number, machine:string)=>Promise<void>;
  isAdmin: boolean;
}) {
  const t = T[lang];
  const [target, setTarget]           = useState<BookTarget | null>(null);
  const [modTarget, setModTarget]     = useState<ModifyTarget | null>(null);
  const [slotDetail, setSlotDetail]   = useState<SlotDetailTarget | null>(null);
  const [toast, setToast]             = useState<string | null>(null);

  const fg  = "var(--foreground)";
  const sub = "var(--gray-accessible-text)";
  const div = "var(--border)";
  const hdr = "var(--muted)";

  // Su mobile le colonne hanno larghezza fissa e la griglia scorre in
  // orizzontale: è l'unico modo per far stare sette giorni su un telefono.
  // Su desktop quella stessa griglia diventava una colonnina di 524px persa in
  // un contenitore largo il doppio, con testo da 8px. Qui le colonne si
  // dividono lo spazio disponibile e tutto cresce di conseguenza.
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const DAY_W  = 68;
  const TIME_W = isDesktop ? 60 : 48;
  const ROW_H  = isDesktop ? 76 : 60;

  const dayCol = isDesktop
    ? { flex: "1 1 0", minWidth: 0 }
    : { width: DAY_W, flexShrink: 0 };

  const fsDay   = isDesktop ? "text-[11px]" : "text-[9px]";
  const fsSlot  = isDesktop ? "text-[11px]" : "text-[9px]";
  const fsChip  = isDesktop ? "text-[11px]" : "text-[8px]";

  async function confirmBooking(room: string) {
    if (!target) return;
    const ti = target; const d = ti.dayIdx ?? TODAY_DOW;
    setTarget(null);
    try {
      if (week[d]?.[ti.slotIdx]?.[ti.machineId]) await onClear(d, ti.slotIdx, ti.machineId);
      await onBook(d, ti.slotIdx, ti.machineId, room);
      setToast(`${t.slotConfirmed} · ${TIME_SLOTS[ti.slotIdx].start}`);
    } catch (e) { setToast(errMsg(e, lang)); }
  }

  async function deleteBooking() {
    if (!modTarget) return;
    const mt = modTarget;
    setModTarget(null);
    try { await onClear(mt.dayIdx, mt.slotIdx, mt.machineId); setToast(t.slotDeleted); }
    catch (e) { setToast(errMsg(e, lang)); }
  }

  async function deleteFromDetail(dayIdx: number, slotIdx: number, mid: string) {
    setSlotDetail(null);
    try { await onClear(dayIdx, slotIdx, mid); setToast(t.slotDeleted); }
    catch (e) { setToast(errMsg(e, lang)); }
  }

  // Nessun tetto di larghezza: la griglia ha sette colonne e piu' spazio ha,
  // piu' e' leggibile. Limitandola qui, il contenitore esterno resterebbe
  // vuoto ai lati — che era esattamente il problema.
  return (
    <div className="flex flex-col h-full w-full">
      {toast      && <Toast msg={toast} onClose={()=>setToast(null)}/>}
      {target     && <BookModal target={target} bookings={week} status={status} isDark={false} lang={lang} myRoom={sessionRoom} isAdmin={isAdmin} onConfirm={confirmBooking} onClose={()=>setTarget(null)}/>}
      {modTarget  && (
        <ModifyModal
          target={modTarget} isDark={false} lang={lang}
          onEdit={()=>{ setTarget({ slotIdx:modTarget.slotIdx, machineId:modTarget.machineId, dayIdx:modTarget.dayIdx, prefillRoom:modTarget.currentRoom }); setModTarget(null); }}
          onDelete={deleteBooking}
          onClose={()=>setModTarget(null)}
        />
      )}
      {slotDetail && (
        <SlotDetailSheet
          target={slotDetail}
          bookings={week}
          isDark={false}
          lang={lang}
          roomNumber={sessionRoom}
          onBook={(mid)=>{ setTarget({ dayIdx:slotDetail.dayIdx, slotIdx:slotDetail.slotIdx, machineId:mid }); setSlotDetail(null); }}
          onModify={(mid, room)=>{ setModTarget({ dayIdx:slotDetail.dayIdx, slotIdx:slotDetail.slotIdx, machineId:mid, currentRoom:room }); setSlotDetail(null); }}
          onDelete={(mid)=>{ deleteFromDetail(slotDetail.dayIdx, slotDetail.slotIdx, mid); }}
          onClose={()=>setSlotDetail(null)}
        />
      )}

      <div className="px-5 pt-3 pb-2 shrink-0">
        <h2 className="text-base font-bold" style={{ color:fg }}>{t.overview}</h2>
      </div>

      <div className="flex-1 overflow-auto">
        <div style={isDesktop ? { width: "100%" } : { minWidth: TIME_W + DAY_W * 7 }}>

          <div className="flex" style={{ position:"sticky", top:0, zIndex:3, background:hdr, borderBottom:`1px solid ${div}` }}>
            <div style={{ width:TIME_W, flexShrink:0, position:"sticky", left:0, zIndex:4, background:hdr }}
              className="flex items-end justify-center pb-2">
              <span className={`${fsDay} font-mono uppercase`} style={{ color:sub }}>{t.now}</span>
            </div>
            {t.days.map((d, i) => {
              const isToday = i===TODAY_DOW;
              const isPast  = i<TODAY_DOW;
              return (
                <div key={d} className="flex flex-col items-center py-2 gap-0.5" style={dayCol}>
                  <span className={`${fsDay} font-mono uppercase`} style={{ color:isToday?RED:isPast?`color-mix(in srgb, var(--muted-foreground) 40%, transparent)`:sub }}>{d}</span>
                  <div className={`${isDesktop ? "w-8 h-8" : "w-7 h-7"} rounded-full flex items-center justify-center`} style={{ background:isToday?RED:"transparent" }}>
                    <span className="text-sm font-bold" style={{ color:isToday?RED_FG:isPast?`color-mix(in srgb, var(--muted-foreground) 40%, transparent)`:sub }}>{DAYS_DATE[i]}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {TIME_SLOTS.map((slot, si) => (
            <div key={slot.start} className="flex" style={{ borderBottom:`1px solid ${div}` }}>
              <div style={{ width:TIME_W, flexShrink:0, position:"sticky", left:0, zIndex:1, background:hdr, minHeight:ROW_H }}
                className="flex items-start justify-end pr-2 pt-1.5">
                <span className={`${fsSlot} font-mono tabular-nums`} style={{ color:sub }}>{slot.start}</span>
              </div>

              {t.days.map((_, dayIdx) => {
                const dayData  = week[dayIdx] ?? {};
                const slotData = dayData[si] ?? {};
                const rooms    = Object.entries(slotData);
                const isToday  = dayIdx===TODAY_DOW;
                const isPastDay= dayIdx<TODAY_DOW;
                const isCur    = isToday && si===CUR_SLOT;
                const isPrevSl = isToday && si===PREV_SLOT;
                const isPast   = isPastDay || (isToday && si<CUR_SLOT);

                return (
                  <button key={dayIdx}
                    onClick={()=>{ if(!isPast) setSlotDetail({ dayIdx, slotIdx:si }); }}
                    className={`relative flex flex-col justify-start pt-1 gap-0.5 text-left transition-colors border-l ${isDesktop ? "px-1.5 hover:brightness-95" : "px-1"}`}
                    style={{ ...dayCol, minHeight:ROW_H, background:isCur?`color-mix(in srgb, var(--primary) 8%, transparent)`:isPrevSl?`color-mix(in srgb, var(--chart-4) 5%, transparent)`:"transparent", borderColor:div, opacity:isPast?0.38:1, cursor:isPast?"default":"pointer" }}>
                    {isCur    && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background:RED }}/>}
                    {isPrevSl && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background:ORANGE }}/>}
                    {rooms.map(([mid, room]) => {
                      const isMe = !!sessionRoom && room === sessionRoom;
                      return (
                        <div key={mid} className={`rounded-md flex items-center gap-1 w-full border ${isDesktop ? "px-1.5 py-1" : "px-1 py-0.5"}`}
                          style={{
                            background: isMe ? RED : "var(--secondary)",
                            borderColor: isMe ? RED : "var(--border)",
                          }}>
                          <span className={`${fsChip} font-mono font-bold shrink-0`} style={{ color:isMe?RED_FG:sub }}>{mid[2]}</span>
                          <span className={`${fsChip} font-mono truncate`} style={{ color:isMe?RED_FG:fg }}>{room}</span>
                        </div>
                      );
                    })}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Admin sheet (bottom sheet dalla dashboard) ───────────────────────────────

function SegnalaGuastoSheet({ lang, status, onStatus, onClose, roomNumber }: {
  theme?: Theme; lang: Lang; status: StatusData; roomNumber: string | null;
  onStatus: (machine:string, oos:boolean)=>Promise<void>; onClose: () => void;
}) {
  const t = T[lang];
  const [toast, setToast] = useState<string | null>(null);
  const bg   = "var(--background)";
  const fg   = "var(--foreground)";
  const sub  = "var(--gray-accessible-text)";
  const surf = "var(--card)";
  const div  = "var(--border)";

  const mk = (id: string, type: MachineType): Machine => ({
    id, label: id[2], type, status: status[id] === "oos" ? "out-of-order" : "available",
  });
  
  const avail = machinesFor(roomNumber);
  const washers: Machine[] = avail.washers.map((id)=>mk(id,"washer"));
  const dryers:  Machine[] = avail.dryers.map((id)=>mk(id,"dryer"));

  async function toggle(m: Machine) {
    if (m.status === "out-of-order") return;   // gia' segnalata, niente da fare
    try { await onStatus(m.id, true); setToast(t.reportSent(m.label)); }
    catch (e) { setToast(errMsg(e, lang)); }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
      <div className="w-full rounded-t-3xl pb-8 overflow-y-auto" style={{ background:bg, maxHeight:"80%" }} onClick={(e)=>e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4">
          <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-mono tracking-widest uppercase mb-0.5" style={{ color:sub }}>{t.machineMgmt}</p>
              <p className="text-lg font-bold" style={{ color:fg }}>{t.oos}</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl" style={{ color:sub, background:"var(--secondary)" }}>
              <X size={16}/>
            </button>
          </div>
          <p className="text-xs mt-1" style={{ color:sub }}>{t.oosDesc}</p>
        </div>

        <div className="px-5 mb-4">
          <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.washers}</p>
          <div className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
            {washers.map((m, i) => (
              <SegnalaGuastoRow key={m.id} machine={m} lang={lang} isLast={i===washers.length-1} divColor={div} onToggle={()=>toggle(m)} />
            ))}
          </div>
        </div>

        <div className="px-5">
          <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.dryers}</p>
          <div className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
            {dryers.map((m, i) => (
              <SegnalaGuastoRow key={m.id} machine={m} lang={lang} isLast={i===dryers.length-1} divColor={div} onToggle={()=>toggle(m)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SegnalaGuastoRow({ machine, lang, isLast, divColor, onToggle }: {
  machine: Machine; lang: Lang; isLast: boolean; divColor: string; onToggle: () => void;
}) {
  const t   = T[lang];
  const fg  = "var(--foreground)";
  const isOOO = machine.status === "out-of-order";

  return (
    <div className="flex items-center gap-4 px-4 py-3.5"
      style={{ borderBottom:isLast?"none":`1px solid ${divColor}`, background:isOOO?`color-mix(in srgb, var(--destructive) 10%, transparent)`:"transparent" }}>
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <span className="size-2 rounded-full shrink-0" style={{ background:isOOO?OOS_C:GREEN }}/>
        <div className="flex items-center gap-2" style={{ color:fg }}>
          {machine.type==="washer" ? <WashingMachine size={16}/> : <Wind size={16}/>}
          <span className="text-base font-mono font-bold">{machine.label}</span>
        </div>
        <span className="text-xs font-medium ml-1" style={{ color:isOOO?OOS_C:GREEN }}>
          {isOOO ? t.oos : t.operative}
        </span>
      </div>
      {/* Il residente segnala, non decide: mettere e togliere il fuori servizio
          e' passato agli amministratori. Se e' gia' segnalata non c'e' niente
          da fare, quindi il pulsante e' disattivato invece che nascosto —
          cosi' si capisce che la segnalazione e' gia' arrivata. */}
      <button onClick={onToggle} disabled={isOOO}
        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold shrink-0 transition-all active:scale-95 disabled:active:scale-100"
        style={isOOO
          ? { background:"var(--secondary)", color:"var(--gray-accessible-text)", cursor:"default" }
          : { background:`color-mix(in srgb, var(--destructive) 12%, transparent)`, color:OOS_C }}>
        {isOOO ? <><AlertTriangle size={12}/>{t.alreadyOos}</> : <><Wrench size={12}/>{t.reportAction}</>}
      </button>
    </div>
  );
}

// ─── Login screen ─────────────────────────────────────────────────────────────

// Il numero che apre l'accesso amministratore invece di entrare in una camera.
// Non è una password — chi lo conosce vede solo il form di login — ma tiene la
// voce fuori dal menu dei residenti, dove non serviva a nessuno di loro.
// 1935: l'anno di fondazione del collegio.
const ROOM_ADMIN = "1935";

function LoginScreen({ lang, onLogin, onAdmin }: {
  theme?: Theme; lang: Lang; onLogin: (room: string) => void; onAdmin: () => void;
}) {
  const t = T[lang];
  const [room, setRoom] = useState("");
  const fg   = "var(--foreground)";
  const sub  = "var(--gray-accessible-text)";
  const chip = "var(--secondary)";
  const surf = "var(--card)";

  // I tasti che il tastierino accetta, gli stessi disegnati a schermo.
  const AMMESSI = /^[0-9abAB-]$/;

  function submit() {
    if (room.length === 0) return;
    if (room === ROOM_ADMIN) { setRoom(""); onAdmin(); return; }
    const regexCamera = /^\d+(?:-?[a-bA-B])?$/;
    if (!regexCamera.test(room)) {
      alert("Formato non valido. Esempi validi: 112, 21-b, 112A");
      return;
    }
    onLogin(room);
  }

  // Da computer si scrive con la tastiera, tastierino numerico compreso: qui
  // non c'è un campo di testo da mettere a fuoco, quindi i tasti vanno presi
  // dalla finestra. Non è solo comodità — senza, chi non usa il mouse non
  // aveva alcun modo di inserire la camera.
  //
  // L'effetto si riaggancia a ogni cambio di `room` perché submit() legge il
  // valore corrente: con [] la chiusura resterebbe ferma alla stringa vuota e
  // Invio non farebbe mai niente.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;   // scorciatoie del browser
      if (e.key === "Enter")     { e.preventDefault(); submit(); return; }
      if (e.key === "Backspace") { e.preventDefault(); setRoom(r=>r.slice(0,-1)); return; }
      if (e.key === "Escape")    { setRoom(""); return; }
      if (AMMESSI.test(e.key))   { e.preventDefault(); setRoom(r=>r.length<6?r+e.key:r); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [room]);

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6">
      <div className="flex flex-col items-center mb-10">
        <div className="p-4 rounded-3xl mb-5" style={{ background:`color-mix(in srgb, var(--primary) 18%, transparent)` }}>
          <WashingMachine size={36} style={{ color:RED }}/>
        </div>
        <h1 className="text-2xl font-bold mb-1 text-center" style={{ color:fg }}>{t.welcome}</h1>
        <p className="text-sm text-center leading-relaxed" style={{ color:sub }}>
          {t.enterRoom}
        </p>
      </div>

      <div className="w-full rounded-2xl px-5 py-4 mb-5 flex items-center justify-between border" style={{ background:surf, borderColor:"var(--border)" }}>
        <span className="text-sm font-mono" style={{ color:sub }}>{t.room}</span>
        <span className="text-4xl font-mono font-bold tabular-nums" style={{ color:room?fg:`color-mix(in srgb, var(--foreground) 15%, transparent)` }}>
          {room || "—"}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2.5 w-full mb-4">
        {/* setRoom(r => …) e non setRoom(room + k): due tocchi nello stesso
            istante leggerebbero entrambi lo stesso valore vecchio e la prima
            cifra andrebbe persa. Con la forma funzionale si accodano. */}
        {["1","2","3","A", "4","5","6","B", "7","8","9","-"].map((k)=>(
          <button key={k} onClick={()=>setRoom(r=>r.length<6?r+k:r)}
            className="rounded-2xl h-14 text-xl font-bold transition-all active:scale-95"
            style={{ background:chip, color:fg }}>{k}</button>
        ))}
        <button onClick={()=>setRoom(r=>r.slice(0,-1))}
          className="rounded-2xl h-14 flex items-center justify-center transition-all active:scale-95 col-span-1"
          style={{ background:chip, color:sub }}><Delete size={20}/></button>
        <button onClick={()=>setRoom(r=>r.length<6?r+"0":r)}
          className="rounded-2xl h-14 text-xl font-bold transition-all active:scale-95 col-span-1"
          style={{ background:chip, color:fg }}>0</button>
        <button onClick={submit}
          className="rounded-2xl h-14 text-xl font-bold transition-all active:scale-95 text-white col-span-2"
          style={{ background:room.length>0?RED:chip, color:room.length>0?RED_FG:sub }}>→</button>
      </div>

      <button
        onClick={()=>onLogin("")}
        className="w-full py-3.5 rounded-2xl text-sm font-medium transition-all active:scale-[0.98] border"
        style={{ borderColor:"var(--border)", color:sub, background:"transparent" }}>
        {t.skip}
      </button>

      {/* Solo da schermo grande: su un telefono la tastiera fisica non c'è e
          la riga sarebbe un'istruzione impossibile da seguire. */}
      <p className="text-[10px] mt-4 hidden md:block" style={{ color:sub }}>
        {lang === "it"
          ? "Puoi anche digitare da tastiera e premere Invio."
          : "You can also type on your keyboard and press Enter."}
      </p>

      <p className="text-[10px] font-mono mt-6" style={{ color:sub }}>v. {APP_VERSION} (beta)</p>
    </div>
  );
}

// ─── Bottom nav ───────────────────────────────────────────────────────────────

function BottomNav({ active, onChange, lang }: { active:number; onChange:(i:number)=>void; theme?:Theme; lang:Lang }) {
  const t = T[lang];
  const tabs = [
    { icon:Clock,        label:"Dashboard" },
    { icon:CalendarDays, label:t.daily     },
    { icon:LayoutGrid,   label:t.weekly    },
  ];
  return (
    // paddingBottom con la safe-area: su iPhone l'ultima riga di pulsanti
    // finiva sotto la barra dell'indicatore home, che la copre a metà. Su
    // tutto il resto env() vale 0 e non cambia niente.
    <div className="flex shrink-0 border-t"
      style={{
        background:"var(--background)", borderColor:"var(--border)",
        paddingBottom:"env(safe-area-inset-bottom, 0px)",
      }}>
      {tabs.map((tab,i)=>{ const Icon=tab.icon; return (
        <button key={i} onClick={()=>onChange(i)} className="flex-1 flex flex-col items-center gap-1 py-3 transition-colors"
          style={{ color:active===i?RED:"var(--gray-accessible-text)" }}>
          <Icon size={19}/><span className="text-[9px] font-medium tracking-wide">{tab.label}</span>
        </button>
      ); })}
    </div>
  );
}

// ─── Sidebar desktop ──────────────────────────────────────────────────────────

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );
  useEffect(() => {
    const m = window.matchMedia(query);
    const handler = () => setMatches(m.matches);
    handler();
    m.addEventListener("change", handler);
    return () => m.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

function DesktopSidebar({ active, onChange, lang, roomNumber, showNav, facility, onFacility, adminRole, onChangeRoom, onOpenSettings }: {
  active: number; onChange: (i: number) => void; lang: Lang;
  roomNumber: string | null; showNav: boolean;
  facility: Facility; onFacility: (f: Facility) => void;
  adminRole: AdminRole | null;
  onChangeRoom: () => void; onOpenSettings: () => void;
}) {
  const t   = T[lang];
  const fg  = "var(--foreground)";
  const sub = "var(--gray-accessible-text)";
  const div = "var(--border)";
  const tabs = [
    { icon: Clock,        label: "Dashboard" },
    { icon: CalendarDays, label: t.daily     },
    { icon: LayoutGrid,   label: t.weekly    },
  ];
  return (
    <aside className="w-60 shrink-0 h-dvh flex flex-col border-r" style={{ background:"var(--background)", borderColor:div }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16 shrink-0 border-b" style={{ borderColor:div }}>
        <div className="p-2 rounded-xl" style={{ background:"color-mix(in srgb, var(--primary) 15%, transparent)" }}>
          <WashingMachine size={20} style={{ color:RED }}/>
        </div>
        <span className="text-lg font-bold" style={{ color:fg }}>Sez. Valentino</span>
      </div>

      {/* Navigazione */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        {/* Strutture: Lavanderia / Cinema / Musica */}
        {showNav && FACILITIES.map(({ id, icon: Icon, label }) => {
          const isActive = facility === id;
          return (
            <button key={id} onClick={()=>onFacility(id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${isActive ? "" : "desk-nav"}`}
              style={isActive ? { background:RED, color:RED_FG } : { color:sub }}>
              <Icon size={18}/>{label[lang]}
            </button>
          );
        })}

        {/* Sotto-sezioni della Lavanderia */}
        {showNav && facility === "laundry" && (
          <>
            <div className="h-px my-2 mx-2" style={{ background:div }}/>
            {tabs.map((tab, i) => {
              const Icon = tab.icon;
              const isActive = active === i;
              return (
                <button key={i} onClick={()=>onChange(i)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-colors text-left ${isActive ? "" : "desk-nav"}`}
                  style={isActive ? { background:`color-mix(in srgb, var(--primary) 15%, transparent)`, color:RED } : { color:sub }}>
                  <Icon size={15}/>{tab.label}
                </button>
              );
            })}
          </>
        )}

        {/* Sezioni amministrative: stesso livello delle strutture, in coda e
            separate perché sono di natura diversa. Compaiono solo con una
            sessione attiva; l'uscita sta dentro la sezione stessa. */}
        {showNav && adminSectionsFor(adminRole).length > 0 && (
          <>
            <div className="h-px my-2 mx-2" style={{ background:div }}/>
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color:sub }}>
              {lang === "it" ? "Amministrazione" : "Administration"}
            </p>
            {adminSectionsFor(adminRole).map(({ id, icon: Icon, label }) => {
              const isActive = facility === id;
              return (
                <button key={id} onClick={()=>onFacility(id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${isActive ? "" : "desk-nav"}`}
                  style={isActive ? { background:RED, color:RED_FG } : { color:sub }}>
                  <Icon size={18}/>{label[lang]}
                </button>
              );
            })}
          </>
        )}
      </nav>

      {/* Controlli */}
      <div className="px-3 py-4 border-t flex flex-col gap-2 shrink-0" style={{ borderColor:div }}>
        {roomNumber !== null && (
          <button onClick={onChangeRoom}
            className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors desk-nav"
            style={{ color:fg }}>
            <span className="font-mono">{roomLabel(roomNumber, t)}</span>
            <LogOut size={13} style={{ color:sub }}/>
          </button>
        )}
        {/* Lingua, notifiche, installazione, accessibilità stanno tutte dentro
            Impostazioni. Il refresh manuale è sparito (tornare sull'app ricarica
            già i dati) e il tema segue sempre quello del sistema. */}
        <button onClick={onOpenSettings}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors desk-nav"
          style={{ color:fg }}>
          <Settings size={16} style={{ color:sub }}/>{lang === "it" ? "Impostazioni" : "Settings"}
        </button>
        <p className="text-center text-[10px] font-mono pt-1" style={{ color:sub }}>v. {APP_VERSION} (beta)</p>
      </div>
    </aside>
  );
}

// ─── Stati di caricamento / errore ─────────────────────────────────────────────

function CenterState({ children }: { isDark?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4"
      style={{ color:"var(--gray-accessible-text)" }}>
      {children}
    </div>
  );
}

// ─── Selettore struttura (Lavanderia / Cinema / Musica) ───────────────────────

const FACILITIES: { id: Facility; icon: any; label: { it: string; en: string } }[] = [
  { id: "laundry", icon: WashingMachine, label: { it: "Lavanderia", en: "Laundry" } },
  { id: "cinema",  icon: Film,           label: { it: "Cinema",     en: "Cinema" } },
  { id: "music",   icon: Music,          label: { it: "Musica",     en: "Music" } },
];

// Le voci riservate al sistemista non compaiono con la sessione FDO, ma il
// controllo vero resta sul server: nascondere una voce non è un'autorizzazione.
const ADMIN_SECTIONS: {
  id: AdminTab; icon: any; label: { it: string; en: string }; sistemistaOnly?: boolean;
}[] = [
  { id: "macchine",     icon: Wrench,        label: { it: "Macchine",     en: "Machines" } },
  { id: "segnalazioni", icon: MessageSquare, label: { it: "Segnalazioni", en: "Reports" } },
  { id: "ricorrenti",   icon: Repeat,        label: { it: "Ricorrenti",   en: "Recurring" },   sistemistaOnly: true },
  { id: "manutenzione", icon: Eraser,        label: { it: "Manutenzione", en: "Maintenance" }, sistemistaOnly: true },
];

const adminSectionsFor = (role: AdminRole | null) =>
  role === null ? [] : ADMIN_SECTIONS.filter((s) => !s.sistemistaOnly || role === "sistemista");

function FacilitySwitcher({ facility, onChange, lang, adminRole }: {
  facility: Facility; onChange: (f: Facility)=>void; lang: Lang; adminRole: AdminRole | null;
}) {
  const sections = adminSectionsFor(adminRole);

  const Chip = ({ id, icon: Icon, label }: { id: Facility; icon: any; label: string }) => {
    const active = facility === id;
    return (
      <button onClick={()=>onChange(id)}
        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 border"
        style={active
          ? { background:RED, color:RED_FG, borderColor:RED }
          : { background:"var(--secondary)", color:"var(--gray-accessible-text)", borderColor:"var(--border)" }}>
        <Icon size={14}/>{label}
      </button>
    );
  };

  return (
    <div className="shrink-0">
      <div className="flex gap-1.5 px-5 pt-3 pb-1">
        {FACILITIES.map(({ id, icon, label }) => (
          <Chip key={id} id={id} icon={icon} label={label[lang]}/>
        ))}
      </div>

      {/* Sotto, non mescolate alle prime tre: sono destinazioni dello stesso
          livello ma di natura diversa, e affiancarle a Lavanderia le avrebbe
          compresse tutte e sei fino a renderle illeggibili.
          Due per riga e non quattro: in fila su 375px "Manutenzione" finiva
          oltre il bordo dello schermo e veniva tagliata. */}
      {sections.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 px-5 pt-1.5">
          {sections.map(({ id, icon, label }) => (
            <Chip key={id} id={id} icon={icon} label={label[lang]}/>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Impostazioni ───────────────────────────────────────────────────────────
//
// Un solo pulsante al posto di quattro-cinque icone sparse nell'header: lingua,
// notifiche, installazione app, accessibilità. Il refresh manuale è sparito del
// tutto (riaprire l'app ricarica già i dati da sola) e così il selettore
// manuale del tema, che ora segue sempre quello del telefono — vedi l'effetto
// che ascolta prefers-color-scheme in cima al componente App.
function SettingsSheet({ lang, room, adminRole, onLogoutAdmin, onToggleLang, onAccessibility, onClose }: {
  lang: Lang; room: string | null;
  adminRole: AdminRole | null; onLogoutAdmin: () => void;
  onToggleLang: () => void; onAccessibility: () => void; onClose: () => void;
}) {
  const it = lang === "it";
  const fg  = "var(--foreground)";
  const sub = "var(--gray-accessible-text)";
  const div = "var(--border)";

  const [reminderState, setReminderState] = useState<push.ReminderState>("unknown");
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const standalone = typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true);

  useEffect(() => { push.getReminderState().then(setReminderState); }, []);

  async function toggleReminders() {
    if (busy || !room) return;
    setBusy(true);
    try {
      if (reminderState === "on") { await push.disableReminders(); setReminderState("off"); }
      else { await push.enableReminders(room); setReminderState(await push.getReminderState()); }
    } catch (e: any) {
      if (String(e?.message) === "denied") setReminderState("denied");
    } finally { setBusy(false); }
  }

  const reminderSub = reminderState === "denied"
    ? (it ? "Bloccate dal browser" : "Blocked by the browser")
    : reminderState === "on" ? (it ? "Attive" : "On") : (it ? "Non attive" : "Off");

  const Row = ({ icon, label, sub: subtext, onClick }: {
    icon: React.ReactNode; label: string; sub?: string; onClick: () => void;
  }) => (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors active:scale-[0.99]">
      <span style={{ color: sub }}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold" style={{ color: fg }}>{label}</span>
        {subtext && <span className="block text-xs" style={{ color: sub }}>{subtext}</span>}
      </span>
      <ChevronRight size={16} style={{ color: sub, opacity: 0.5 }} />
    </button>
  );

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pb-8" style={{ background:"var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 flex items-center justify-between">
          <p className="text-lg font-bold" style={{ color:fg }}>{it ? "Impostazioni" : "Settings"}</p>
          <button onClick={onClose} className="p-2 rounded-xl" style={{ color:sub, background:"var(--secondary)" }}>
            <X size={16}/>
          </button>
        </div>

        <div className="rounded-2xl overflow-hidden border mx-5" style={{ borderColor:div }}>
          <div style={{ borderBottom:`1px solid ${div}` }}>
            <Row icon={<Globe size={18}/>} label={it ? "Lingua" : "Language"}
              sub={it ? "Italiano" : "English"} onClick={onToggleLang}/>
          </div>
          {room && (
            <div style={{ borderBottom:`1px solid ${div}` }}>
              <Row icon={reminderState==="on" ? <BellRing size={18}/> : <Bell size={18}/>}
                label={it ? "Notifiche turni" : "Shift reminders"} sub={reminderSub}
                onClick={() => setRemindersOpen(true)}/>
            </div>
          )}
          {!standalone && (
            <div style={{ borderBottom:`1px solid ${div}` }}>
              <Row icon={<Download size={18}/>} label={it ? "Installa l'app" : "Install the app"}
                onClick={() => { window.dispatchEvent(new Event("open-install")); onClose(); }}/>
            </div>
          )}
          <Row icon={<Eye size={18}/>} label={it ? "Accessibilità" : "Accessibility"}
            onClick={() => { onAccessibility(); onClose(); }}/>
        </div>

        {/* L'accesso amministratore non sta qui: si apre digitando 1935 al
            posto della camera. Un menu con una voce che il 99% di chi lo apre
            non può usare sarebbe solo rumore.
            L'uscita invece sì: dentro le sezioni riservate c'è già, ma un
            amministratore passa la maggior parte del tempo sulla dashboard
            normale, e da lì non aveva alcun modo di chiudere la sessione. */}
        {adminRole !== null && (
          <div className="rounded-2xl overflow-hidden border mx-5 mt-4" style={{ borderColor:div }}>
            <div className="px-4 pt-3 pb-2 flex items-start gap-2">
              <ShieldCheck size={14} style={{ color:sub, marginTop:2 }}/>
              <p className="text-[11px] leading-snug" style={{ color:sub }}>
                {it
                  ? `Sessione ${adminRole === "sistemista" ? "sistemista" : "FDO"} attiva. Prenoti come Direzione, non come camera.`
                  : `${adminRole === "sistemista" ? "Sysadmin" : "FDO"} session active. You book as Direzione, not as a room.`}
              </p>
            </div>
            <div style={{ borderTop:`1px solid ${div}` }}>
              <Row icon={<LogOut size={18}/>}
                label={it ? "Esci da amministratore" : "Sign out of administration"}
                sub={it ? "Torni a scegliere una camera" : "Back to picking a room"}
                onClick={() => { onClose(); onLogoutAdmin(); }}/>
            </div>
          </div>
        )}
      </div>

      {remindersOpen && (
        <RemindersSheet lang={lang} room={room} state={reminderState} busy={busy}
          onToggle={toggleReminders} onClose={() => setRemindersOpen(false)} />
      )}
    </div>
  );
}

// ─── Pannello promemoria: push + Telegram ──────────────────────────────────────
//
// Telegram è l'alternativa che conta su iPhone, dove le notifiche push delle
// web app funzionano solo se l'app è stata installata dalla schermata Home e
// restano capricciose. Il collegamento passa da un codice usa-e-getta: senza,
// chiunque potrebbe scrivere al bot "sono la 112" e ricevere i promemoria altrui.
function RemindersSheet({ lang, room, state, busy, onToggle, onClose }: {
  lang: Lang; room: string | null; state: push.ReminderState;
  busy: boolean; onToggle: () => void; onClose: () => void;
}) {
  const it = lang === "it";
  const [code, setCode] = useState<string | null>(null);
  const [tgBusy, setTgBusy] = useState(false);
  const [tgErr, setTgErr] = useState(false);
  const on = state === "on";
  const bot = import.meta.env.VITE_TELEGRAM_BOT as string | undefined;

  /**
   * Collega Telegram in un tocco solo.
   *
   * Il codice si genera e si passa al bot dentro il link `?start=<codice>`:
   * Telegram lo invia da solo (se l'utente ha già avviato il bot in passato)
   * o mostra il pulsante AVVIA da toccare una volta (la prima volta) — è
   * Telegram stesso a funzionare così, non c'è un modo per saltare quel tocco
   * al primissimo collegamento. Il codice resta visibile come riserva.
   *
   * Prima si apriva una finestra VUOTA e la si reindirizzava dopo la chiamata
   * di rete: molti browser bloccano proprio i popup vuoti-poi-reindirizzati
   * (è la firma di un pattern pubblicitario), quindi la finestra non si apriva
   * mai e il tentativo falliva in silenzio. Ora si apre già il link finale,
   * un solo passaggio, col fallback sulla stessa scheda se anche quello viene
   * bloccato.
   */
  async function linkTelegram() {
    setTgBusy(true); setTgErr(false);
    try {
      const c = await api.telegramCode();
      setCode(c);
      if (bot) {
        const link = `https://t.me/${bot}?start=${c}`;
        const w = window.open(link, "_blank", "noopener,noreferrer");
        if (!w) window.location.href = link;   // popup bloccato: si va diretti
      }
    } catch {
      setTgErr(true);
    } finally { setTgBusy(false); }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pb-8" style={{ background:"var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4">
          <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background:"color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
          <div className="flex items-center justify-between mb-1">
            <p className="text-lg font-bold" style={{ color:"var(--foreground)" }}>
              {it ? "Promemoria turni" : "Shift reminders"}
            </p>
            <button onClick={onClose} className="p-2 rounded-xl" style={{ color:"var(--gray-accessible-text)", background:"var(--secondary)" }}>
              <X size={16}/>
            </button>
          </div>
          <p className="text-xs" style={{ color:"var(--gray-accessible-text)" }}>
            {it ? "Ti avvisiamo poco prima che inizi il tuo turno." : "We'll ping you shortly before your shift starts."}
          </p>
        </div>

        <div className="px-5 space-y-3">
          {/* Notifiche del browser */}
          <div className="rounded-2xl border p-4" style={{ background:"var(--card)", borderColor:"var(--border)" }}>
            <div className="flex items-center gap-3">
              <BellRing size={18} style={{ color: on ? RED : "var(--gray-accessible-text)" }}/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color:"var(--foreground)" }}>
                  {it ? "Notifiche del telefono" : "Phone notifications"}
                </p>
                <p className="text-xs" style={{ color:"var(--gray-accessible-text)" }}>
                  {state === "unsupported"
                    ? (it ? "Non disponibili su questo dispositivo" : "Not available on this device")
                    : state === "denied"
                    ? (it ? "Bloccate nelle impostazioni del browser" : "Blocked in browser settings")
                    : on ? (it ? "Attive" : "On") : (it ? "Non attive" : "Off")}
                </p>
              </div>
              {state !== "denied" && state !== "unsupported" && (
                <button onClick={onToggle} disabled={busy}
                  className="rounded-xl px-3 py-2 text-xs font-semibold shrink-0"
                  style={on
                    ? { background:"var(--secondary)", color:"var(--gray-accessible-text)" }
                    : { background:`color-mix(in srgb, ${RED} 12%, transparent)`, color:RED }}>
                  {busy ? "…" : on ? (it ? "Disattiva" : "Turn off") : (it ? "Attiva" : "Turn on")}
                </button>
              )}
            </div>
          </div>

          {/* Telegram */}
          <div className="rounded-2xl border p-4" style={{ background:"var(--card)", borderColor:"var(--border)" }}>
            <div className="flex items-center gap-3">
              <Send size={18} style={{ color:"var(--gray-accessible-text)" }}/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color:"var(--foreground)" }}>Telegram</p>
                <p className="text-xs" style={{ color:"var(--gray-accessible-text)" }}>
                  {it ? "Utile su iPhone, dove le notifiche sono capricciose" : "Handy on iPhone, where push is unreliable"}
                </p>
              </div>
              <button onClick={linkTelegram} disabled={tgBusy || !room}
                className="rounded-xl px-3 py-2 text-xs font-semibold shrink-0"
                style={{ background:`color-mix(in srgb, ${RED} 12%, transparent)`, color:RED }}>
                {tgBusy ? "…" : code ? (it ? "Riapri" : "Reopen") : (it ? "Collega" : "Link")}
              </button>
            </div>

            {tgErr && (
              <p className="text-xs mt-3" style={{ color:RED }}>
                {it ? "Non è riuscito. Riprova." : "Didn't work. Try again."}
              </p>
            )}

            {code && (
              <div className="mt-3 pt-3" style={{ borderTop:"1px solid var(--border)" }}>
                <p className="text-xs" style={{ color:"var(--foreground)" }}>
                  {it
                    ? "Ho aperto Telegram: tocca AVVIA nel bot e sei collegato."
                    : "Telegram is open: tap START in the bot and you're linked."}
                </p>
                {/* Riserva, non il percorso principale: serve solo se
                    l'apertura automatica non è andata a buon fine (popup
                    bloccato, Telegram non installato al primo tocco, ecc.).
                    Un link vero — non solo il nome del bot da cercare a mano — perché
                    ricopiare "@nome" e poi il codice a mano è l'esatto attrito
                    che il tocco automatico dovrebbe evitare. */}
                <p className="text-[11px] mt-2 mb-1.5" style={{ color:"var(--gray-accessible-text)" }}>
                  {it ? "Non si è aperto?" : "Didn't open?"}
                </p>
                {bot ? (
                  <a href={`https://t.me/${bot}?start=${code}`} target="_blank" rel="noopener noreferrer"
                     className="block text-center text-xs font-semibold py-2.5 rounded-xl"
                     style={{ background:`color-mix(in srgb, ${RED} 12%, transparent)`, color:RED }}>
                    {it ? "Riprova ad aprire Telegram" : "Try opening Telegram again"}
                  </a>
                ) : (
                  <p className="text-[11px]" style={{ color:"var(--gray-accessible-text)" }}>
                    {it ? "Scrivi al bot questo codice: " : "Message the bot this code: "}
                    <span className="font-mono font-bold tracking-wider" style={{ color:"var(--foreground)" }}>{code}</span>
                  </p>
                )}
                <p className="text-[11px] mt-2" style={{ color:"var(--gray-accessible-text)" }}>
                  {it ? "Vale una volta sola e scade in 24 ore." : "Single use, expires in 24 hours."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Prompt installazione PWA ───────────────────────────────────────────────────
// Se l'app è già installata (standalone) o è già stata chiesta una volta → non
// mostra nulla. Altrimenti propone l'installazione: su Android usa il prompt
// nativo, su iPhone mostra le istruzioni (Condividi → Aggiungi a Home).
function InstallPrompt({ lang }: { lang: Lang }) {
  const t = T[lang];
  const [deferred, setDeferred] = useState<any>(null);
  const [show, setShow] = useState(false);
  const isIOS = /iphone|ipad|ipod/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    if (standalone) return;
    let asked = false;
    try { asked = localStorage.getItem("einaudiplus.installAsked") === "1"; } catch {}
    if (asked) return;

    if (isIOS) {
      const id = setTimeout(() => setShow(true), 1500);
      return () => clearTimeout(id);
    }
    const onReady = () => { setDeferred((window as any).deferredPWAPrompt); setShow(true); };
    if ((window as any).deferredPWAPrompt) onReady();
    window.addEventListener("pwa-installable", onReady);
    return () => window.removeEventListener("pwa-installable", onReady);
  }, [isIOS]);

  // Apertura manuale dal pulsante in alto (ignora il flag "già chiesto").
  useEffect(() => {
    const open = () => { setDeferred((window as any).deferredPWAPrompt); setShow(true); };
    window.addEventListener("open-install", open);
    return () => window.removeEventListener("open-install", open);
  }, []);

  function close() {
    try { localStorage.setItem("einaudiplus.installAsked", "1"); } catch {}
    setShow(false);
  }
  async function install() {
    if (deferred) {
      deferred.prompt();
      try { await deferred.userChoice; } catch {}
    }
    close();
  }

  if (!show) return null;
  // Modalità: iOS (istruzioni Condividi), nativa (prompt del browser),
  // manuale (Android/Samsung senza prompt → istruzioni dal menu).
  const mode: "ios" | "native" | "manual" = isIOS ? "ios" : deferred ? "native" : "manual";
  const bodyText = mode === "ios" ? t.installIosBody : mode === "manual" ? t.installAndroidBody : t.installBody;
  return (
    <div className="absolute inset-0 z-50 flex items-end animate-toast-in" style={{ background: "rgba(0,0,0,0.55)" }} onClick={close}>
      <div className="w-full rounded-t-3xl pt-5 pb-7 px-6" style={{ background: "var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2.5 rounded-2xl" style={{ background: `color-mix(in srgb, var(--primary) 15%, transparent)`, color: RED }}>
            <Download size={20}/>
          </div>
          <p className="text-lg font-bold" style={{ color: "var(--foreground)" }}>{t.installTitle}</p>
        </div>
        <p className="text-sm leading-relaxed mb-5" style={{ color: "var(--gray-accessible-text)" }}>{bodyText}</p>
        {mode === "native" ? (
          <button onClick={install}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold mb-2 transition-all active:scale-[0.98]"
            style={{ background: RED, color: RED_FG }}>
            <Download size={16}/>{t.installCta}
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 mb-2 border text-center"
            style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}>
            {mode === "ios" ? <Share size={16} style={{ color: RED }}/> : <Menu size={16} style={{ color: RED }}/>}
            <span className="text-sm font-medium">{mode === "ios" ? t.installIosStep : t.installAndroidStep}</span>
          </div>
        )}
        <button onClick={close} className="w-full py-3 rounded-2xl text-sm font-medium" style={{ color: "var(--gray-accessible-text)" }}>
          {mode === "native" ? t.installLater : t.installIosDone}
        </button>
      </div>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]   = useState(0);
  const [facility, setFacility] = useState<Facility>("laundry");
  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [_aPrefs, _setAPrefs] = useState<AccessibilityPrefs>(loadPrefs);
  // Il tema segue sempre quello del telefono: niente più selettore manuale né
  // preferenza salvata. Un secondo interruttore che duplica un'impostazione
  // che il sistema operativo offre già non aggiunge nulla, e rischia solo di
  // restare "bloccato" su una scelta vecchia quando l'utente cambia tema al
  // telefono altrove.
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light"
  );
  const [lang,   setLang]     = useState<Lang>("it");
  const [roomNumber] = useState<string | null>(() => {
    try { return localStorage.getItem("laundryhub.room"); } catch { return null; }
  });
  const [week,   setWeek]     = useState<WeekData>({});
  const [status, setStatus]   = useState<StatusData>({});
  const [loading, setLoading] = useState(true);
  const [error,  setError]    = useState<string | null>(null);
  // Preferiti caricati in base alla camera corrente (vedi loadFavs).
  const [favs,   setFavs]     = useState<Fav[]>(() => loadFavs(
    (() => { try { return localStorage.getItem("laundryhub.room"); } catch { return null; } })()
  ));
  const t = T[lang];

  // Quando cambia la stanza (login/logout/cambio camera) ricarico i preferiti
  // di QUELLA stanza, evitando di mostrare quelli della stanza precedente.
  useEffect(() => { setFavs(loadFavs(roomNumber)); }, [roomNumber]);

  const toggleFav = useCallback((day: number, slot: number) => {
    setFavs((prev) => {
      const exists = prev.some((f) => f.day === day && f.slot === slot);
      const next = exists
        ? prev.filter((f) => !(f.day === day && f.slot === slot))
        : [...prev, { day, slot }].sort((a, b) => a.day - b.day || a.slot - b.slot);
      try { if (roomNumber) localStorage.setItem(favsKey(roomNumber), JSON.stringify(next)); } catch {}
      return next;
    });
  }, [roomNumber]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Se l'utente cambia tema al telefono MENTRE l'app è aperta, si adegua
  // subito invece di aspettare una ricarica.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Applica preferenze accessibilità al DOM al mount
  useEffect(() => { applyToDOM(accessibilityPrefs); }, []);

  const handleAccessibilityChange = useCallback((prefs: AccessibilityPrefs) => {
    accessibilityPrefs = prefs;  // aggiorna riferimento modulo per i componenti figli
    _setAPrefs(prefs);           // trigger re-render
    savePrefs(prefs);
    applyToDOM(prefs);
  }, []);
  
  const refresh = useCallback(async () => {
    try {
      const s = await api.getSnapshot();
      setWeek(s.week); setStatus(s.status); setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Il pulsante di refresh manuale è sparito: "torno sull'app e si aggiorna
  // da sola" è vero solo se riaprirla fa davvero un caricamento nuovo. Senza
  // il pulsante, un'app lasciata aperta in background per ore manterrebbe
  // TODAY_DOW/CUR_SLOT calcolati al vecchio caricamento — sono valori fissati
  // all'avvio e non si aggiornano da soli al passare del tempo. Qui si
  // ricarica automaticamente quando l'app torna in primo piano dopo essere
  // rimasta nascosta più di 5 minuti, così l'assunzione diventa vera davvero.
  useEffect(() => {
    let hiddenAt: number | null = null;
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && Date.now() - hiddenAt > 5 * 60_000) {
        window.location.reload();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Se questo dispositivo ha una sessione admin valida, l'app offre in più la
  // prenotazione a nome DIREZIONE e le voci riservate nel menu. Un solo
  // controllo qui, propagato a chi ne ha bisogno — il vero controllo resta
  // comunque sul cookie lato server: nascondere un pulsante non è
  // un'autorizzazione.
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const isAdmin = adminRole !== null;
  useEffect(() => { api.adminRole().then((r) => setAdminRole((r as AdminRole) ?? null)); }, []);

  // Chi esce (o la cui sessione scade) mentre sta guardando una sezione
  // riservata non deve restare su una schermata che non gli appartiene più:
  // lo si riporta in lavanderia. Vale anche per il passaggio sistemista→FDO,
  // che perde Ricorrenti e Manutenzione.
  useEffect(() => {
    if (isAdminFacility(facility) &&
        !adminSectionsFor(adminRole).some((s) => s.id === facility)) {
      setFacility("laundry");
    }
  }, [adminRole, facility]);

  // Un solo punto in cui la sessione amministrativa cambia, da qualunque parte
  // arrivi (login, uscita, scadenza rilevata da una sezione). Chi smette di
  // essere amministratore smette anche di essere la DIREZIONE: senza questo
  // resterebbe con un'identità che non può più usare, e ogni prenotazione
  // fallirebbe lato server senza che si capisca perché.
  const handleAdminSession = useCallback((r: AdminRole | null) => {
    setAdminRole(r);
    // Traccia locale: dice ad adminRole() se al prossimo avvio vale la pena
    // chiedere al server. Vedi il commento in api.ts — non è autorizzazione.
    api.markAdminSeen(r !== null);
    if (r === null && localStorage.getItem("laundryhub.room") === api.DIREZIONE) {
      try { localStorage.removeItem("laundryhub.room"); } catch {}
      window.location.reload();
    }
  }, []);

  const logoutAdmin = useCallback(async () => {
    const { adminLogout } = await import("./AdminPanel");
    await adminLogout();
    handleAdminSession(null);
  }, [handleAdminSession]);

  // Riallinea in silenzio la subscription push col server.
  //
  // Due motivi: il nuovo database parte senza le subscription vecchie, e la
  // chiave VAPID è cambiata — in entrambi i casi chi aveva i promemoria attivi
  // smetterebbe di riceverli senza alcun segnale, perché il browser continua a
  // mostrarli come attivi. Girando a ogni avvio, ogni dispositivo si ripara da
  // solo la prima volta che qualcuno apre l'app.
  useEffect(() => {
    if (!roomNumber) return;
    push.refreshSubscription(roomNumber);
  }, [roomNumber]);

  function chooseRoom(room: string) {
    try { localStorage.setItem("laundryhub.room", room); } catch {}
    window.location.reload();
  }
  // Cambiare camera chiude anche la sessione amministrativa.
  //
  // Prima no, e il risultato era incoerente: "Esci" terminava la sessione,
  // "Cambia camera" lasciava la modalità amministratore attiva sotto un'altra
  // identità. Chi lascia la postazione tocca il pulsante che ha davanti, non
  // quello giusto in teoria — e un dispositivo condiviso restava con i poteri
  // di chi c'era prima. La sessione vive nel cookie, non nella camera: va
  // chiusa sul server, non basta dimenticare il numero.
  async function changeRoom() {
    if (adminRole !== null) {
      try {
        const { adminLogout } = await import("./AdminPanel");
        await adminLogout();
      } catch { /* offline: si esce comunque dalla camera */ }
    }
    try { localStorage.removeItem("laundryhub.room"); } catch {}
    window.location.reload();
  }

  // Un solo punto d'ingresso per tutte e tre le viste: se la camera è
  // DIREZIONE la richiesta passa dall'endpoint amministrativo (autorizzato dal
  // cookie di sessione, non dal client), altrimenti dal percorso normale.
  const handleBook = useCallback(async (day:number, slot:number, machine:string, room:string) => {
    const s = room === api.DIREZIONE
      ? await api.bookAsDirezione(day, slot, machine)
      : await api.book(day, slot, machine, room);
    setWeek(s.week); setStatus(s.status);
  }, []);
  // clear_laundry è già permissiva per chiunque (nessun controllo di proprietà
  // lato server, scelta deliberata in assenza di autenticazione): non serve un
  // percorso amministrativo separato per cancellare, funziona già per tutti.
  const handleClear = useCallback(async (day:number, slot:number, machine:string) => {
    const s = await api.clearBooking(day, slot, machine); setWeek(s.week); setStatus(s.status);
  }, []);
  // Il residente segnala il guasto, non cambia lo stato: la segnalazione finisce
  // fra i feedback e un amministratore decide. Lo stato mostrato non cambia
  // subito, ed e' corretto cosi' — cambiera' quando l'admin l'avra' verificato.
  const handleStatus = useCallback(async (machine:string, _oos:boolean) => {
    await api.reportBroken(machine);
  }, []);

  /**
   * Se mostrare la navigazione (barra in basso, selettore struttura, sidebar).
   *
   * Dipende SOLO dall'aver scelto una camera. Prima era
   * `roomNumber !== null && !loading && !error`, e quel `!error` era il motivo
   * per cui la barra in basso "spariva ogni tanto":
   *
   *   1. l'app è aperta e funziona, poi un refresh fallisce — basta un attimo
   *      di rete ballerina, un ascensore, il passaggio wifi/dati;
   *   2. `error` si popola e TUTTA la navigazione si smonta;
   *   3. se in quel momento eri su Cinema o Musica, il corpo continua a
   *      mostrare la sala (il ramo d'errore vale solo per la lavanderia),
   *      quindi restavi su una schermata senza più alcun modo di uscirne.
   *
   * Un errore di rete transitorio non è un buon motivo per togliere di mezzo
   * la navigazione: i dati già caricati sono ancora in `week`/`status` e
   * restano validi. L'errore va detto nel corpo, dove c'è il pulsante Riprova,
   * non facendo sparire i comandi.
   */
  const showChrome = roomNumber !== null;
  const isDesktop  = useMediaQuery("(min-width: 768px)");

  const globalStyle = (
    <style>{`
      @keyframes toast-in{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
      .animate-toast-in{animation:toast-in .22s ease}
      @keyframes spin{to{transform:rotate(360deg)}}
      .animate-spin-slow{animation:spin 1s linear infinite}
      *{scrollbar-width:none}*::-webkit-scrollbar{display:none}
      .desk-nav{transition:background .15s ease}
      .desk-nav:hover{background:var(--secondary)}
    `}</style>
  );

  const mainContent = loading ? (
    <CenterState>
      <Loader2 size={28} className="animate-spin-slow" style={{ color:RED }}/>
      <p className="text-sm">{t.loading}</p>
    </CenterState>
  ) : error ? (
    <CenterState>
      <AlertTriangle size={28} style={{ color:OOS_C }}/>
      <p className="text-sm">{t.netError}</p>
      <p className="text-xs mt-2" style={{ color: "#888", userSelect: "text" }}>{error}</p>
      <button onClick={()=>{ setLoading(true); refresh(); }}
        className="mt-1 rounded-xl px-4 py-2 text-sm font-semibold" style={{ background:RED, color:RED_FG }}>
        {t.retry}
      </button>
    </CenterState>
  ) : roomNumber === null ? (
    <LoginScreen lang={lang} onLogin={chooseRoom} onAdmin={() => setAdminLoginOpen(true)}/>
  ) : (
    <>
      {screen===0 && <Dashboard   theme={theme} lang={lang} week={week} status={status} roomNumber={roomNumber} favs={favs} onToggleFav={toggleFav} onBook={handleBook} onClear={handleClear} onStatus={handleStatus} isAdmin={isAdmin}/>}
      {screen===1 && <DaySchedule theme={theme} lang={lang} week={week} status={status} roomNumber={roomNumber} favs={favs} onToggleFav={toggleFav} onBook={handleBook} onClear={handleClear} isAdmin={isAdmin}/>}
      {screen===2 && <WeekOverview theme={theme} lang={lang} week={week} status={status} roomNumber={roomNumber} onBook={handleBook} onClear={handleClear} isAdmin={isAdmin}/>}
    </>
  );

  // Lavanderia → schermate laundry; Cinema/Musica → sala a fasce libere;
  // sezioni riservate → pannello amministrativo, nello stesso corpo pagina.
  const isRoom = facility === "cinema" || facility === "music";
  const bodyContent = isAdminFacility(facility)
    // px-5 come le sezioni della lavanderia: senza, le schede amministrative
    // toccavano i bordi dello schermo sul telefono — il corpo pagina non ha
    // padding proprio, se lo mettono le viste.
    ? <div className="px-5"><Suspense fallback={null}><AdminScreens tab={facility} onSession={handleAdminSession}/></Suspense></div>
    : isRoom
      ? <RoomView room={facility} lang={lang} roomNumber={roomNumber}/>
      : mainContent;

  // Pannello accessibilità (modale, condiviso tra mobile e desktop)
  const accessibilityModal = accessibilityOpen && (
    <AccessibilityPanel
      lang={lang}
      prefs={_aPrefs}
      onPrefsChange={handleAccessibilityChange}
      onClose={() => setAccessibilityOpen(false)}
    />
  );

  // Menu e schermate amministrative: identici nei due layout, definiti una
  // volta sola invece che copiati in entrambi i rami.
  const settingsSheet = settingsOpen && (
    <SettingsSheet lang={lang} room={roomNumber}
      adminRole={adminRole} onLogoutAdmin={logoutAdmin}
      onToggleLang={()=>setLang(l=>l==="it"?"en":"it")}
      onAccessibility={() => setAccessibilityOpen(true)}
      onClose={() => setSettingsOpen(false)} />
  );

  // Login amministratore: si apre digitando 1935 al posto della camera.
  // Chi amministra non ha una camera propria: la sua identità è DIREZIONE, e
  // con quella prenota — turni di lavanderia e sale — senza dover scegliere
  // ogni volta per conto di chi sta agendo.
  const adminLoginSheet = adminLoginOpen && (
    <Suspense fallback={null}>
      <AdminLoginSheet
        onClose={() => setAdminLoginOpen(false)}
        onSession={(r) => {
          handleAdminSession(r);
          if (r && roomNumber !== api.DIREZIONE) chooseRoom(api.DIREZIONE);
        }} />
    </Suspense>
  );

  if (isDesktop) {
    return (
      <div className="relative h-dvh w-full flex overflow-hidden"
        style={{ fontFamily:"'DM Sans', sans-serif", background:"var(--background)" }}>
        {globalStyle}
        {showChrome && <InstallPrompt lang={lang}/>}
        {accessibilityModal}
        {settingsSheet}
        {adminLoginSheet}
        <DesktopSidebar
          active={screen} onChange={setScreen} lang={lang}
          roomNumber={roomNumber} showNav={showChrome}
          facility={facility} onFacility={setFacility}
          adminRole={adminRole}
          onChangeRoom={changeRoom}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <main className="flex-1 h-dvh min-h-0 flex flex-col overflow-y-auto overscroll-contain">
          {/* Era max-w-6xl (1152px): su uno schermo grande restavano centinaia
              di pixel vuoti ai lati mentre la griglia settimanale stava
              stretta. 1600px sfrutta lo spazio senza arrivare al bordo su
              monitor molto larghi, dove le righe diventerebbero illeggibili
              da seguire con l'occhio. */}
          <div className="mx-auto w-full max-w-[1600px] flex-1 min-h-0 flex flex-col px-4 lg:px-8">
            {bodyContent}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh w-full flex items-center justify-center md:py-8"
      style={{ fontFamily:"'DM Sans', sans-serif", background:"var(--muted)" }}>
      {globalStyle}
      <div className="relative flex flex-col overflow-hidden w-full h-dvh md:h-[844px] md:max-w-[420px] md:rounded-[3rem] md:shadow-2xl md:border"
        style={{ background:"var(--background)", borderColor:"var(--border)" }}>
        {showChrome && <InstallPrompt lang={lang}/>}
        {accessibilityModal}
        {settingsSheet}
        {adminLoginSheet}

        <div className="flex items-center justify-between px-7 pt-3 pb-0 shrink-0 mt-2 md:mt-0">
          {/* Prima di scegliere una camera qui c'era un orologio finto (9:41,
              lo stesso hardcoded in ogni mockup Apple): non è mai stata l'ora
              vera e non serviva a niente, solo confondeva. */}
          {roomNumber !== null ? (
            <button onClick={changeRoom}
              className="text-[11px] font-mono px-2 py-1 rounded-lg transition-colors"
              style={{ background:"var(--secondary)", color:"var(--gray-accessible-text)" }}>
              {roomLabel(roomNumber, t)}
            </button>
          ) : <span/>}
          <div className="w-24 h-6 rounded-full hidden md:flex items-center justify-center" style={{ background:"var(--secondary)" }}>
            <div className="w-3 h-3 rounded-full border" style={{ background:"var(--background)", borderColor:"var(--border)" }}/>
          </div>
          {/* Il refresh manuale è sparito: tornare sull'app ricarica già i
              dati da sola. Il tema segue sempre quello del telefono. Lingua,
              notifiche, installazione e accessibilità stanno tutte dentro
              Impostazioni, invece di quattro-cinque icone separate. */}
          <button onClick={() => setSettingsOpen(true)} className="p-1.5 rounded-lg" style={{ color:"var(--gray-accessible-text)" }}
            aria-label={lang==="it" ? "Impostazioni" : "Settings"}>
            <Settings size={16}/>
          </button>
        </div>

        {showChrome && <FacilitySwitcher facility={facility} onChange={setFacility} lang={lang} adminRole={adminRole}/>}

        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 flex flex-col mt-2">
          {bodyContent}
        </div>

        {showChrome && !isRoom && !isAdminFacility(facility) && <BottomNav active={screen} onChange={setScreen} theme={theme} lang={lang}/>}
        <div className="pb-2 hidden md:flex justify-center shrink-0">
          <div className="w-28 h-1 rounded-full" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        </div>
      </div>
    </div>
  );
}