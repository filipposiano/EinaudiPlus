import { useState, useEffect, useCallback } from "react";
import {
  Wind, Clock, CalendarDays,
  Sun, Moon, Plus, CheckCircle2, AlertTriangle,
  LayoutGrid, Delete, X, Wrench, RotateCcw, Loader2, Star,
  BedDouble, Timer, Trash2, Film, Music,
  Bell, BellRing,
} from "lucide-react";
import * as api from "./api";
import * as push from "./push";
import RoomView from "./Rooms";

type Facility = "laundry" | "cinema" | "music";

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
const YELLOW = "#eab308";
const ORANGE = "#f59e0b";
const OOS_C  = "var(--destructive)";
const GREEN  = "#22c55e";

// ─── i18n ─────────────────────────────────────────────────────────────────────

const T = {
  it: {
    greeting: (h: number) => h < 12 ? "Buongiorno" : h < 17 ? "Buon pomeriggio" : "Buonasera",
    fmtTime:  (d: Date) => d.toLocaleTimeString("it-IT", { hour:"2-digit", minute:"2-digit" }),
    fmtDay:   (d: Date) => d.toLocaleDateString("it-IT", { weekday:"long", day:"numeric", month:"long" }),
    days:     ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"],
    room:     "Camera", camera: "camera",
    welcome:  "Benvenuto", enterRoom: "Inserisci il numero della tua stanza per accedere",
    skip:     "Continua senza accedere",
    machines: "Lavatrici", // <--- AGGIUNTO
    washers:  "Lavatrici", dryers: "Asciugatrici",
    free:     "Libera", inUse: "In uso", oos: "Fuori servizio", operative: "Operativa",
    book:     "Prenota", reminder: "Reminder", sendReminder: "Manda reminder", sent: "Inviato ✓",
    currentSlot: "Turno corrente", prevSlot: "Turno precedente", now: "ora", prev: "prec.",
    yourBookings: "Le tue prenotazioni",
    inProgressNow: "In corso ora",
    noActiveBookings: "Nessuna prenotazione attiva",
    freeTodayLabel: "turni liberi oggi",
    favorites: "Preferiti",
    noFavs: "Tocca la ★ accanto a un orario nella scheda Giornaliero per aggiungerlo ai preferiti.",
    favFree: "Libero", favFull: "Pieno", favPast: "Passato",
    remainingChip: (n: number) => n >= 0 ? `${n} rimast${n === 1 ? "a" : "e"}` : `${n}`,
    slotEndsIn: "Termina tra",
    remainingMsg: (n: number) => n > 0
      ? `Puoi ancora prenotare ${n} ${n === 1 ? "turno" : "turni"} questa settimana (max ${WEEKLY_QUOTA} a camera).`
      : n === 0
      ? `Hai usato entrambi i turni di questa settimana (max ${WEEKLY_QUOTA} a camera).`
      : `Hai superato il limite settimanale di ${WEEKLY_QUOTA} turni (${-n} in più).`,
    howItWorks: "Come funziona",
    autoWash: (_end: string) => `Lavatrice corrispondente prenotata automaticamente per il turno successivo.`,
    daily:    "Giornaliero", weekly: "Settimana", overview: "Panoramica",
    thisWeek: "Settimana corrente",
    confirm:  "Conferma", cancel: "Annulla", modify: "Modifica stanza", delete: "Elimina prenotazione",
    forMe:    (r: string) => `Per me — Camera ${r}`,
    forOther: "Per qualcun altro",
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
    reportOos:      "Segnala macchina fuori servizio",
    restore:        "Ripristina",
    oosDesc:        "Segnala una macchina non disponibile o ripristinala.",
    reminderSent:   (r: string) => `Reminder inviato · Stanza ${r}`,
    oosSet:         (lbl: string) => `${lbl} segnalata fuori servizio`,
    oosCleared:     (lbl: string) => `${lbl} ripristinata`,
    booked:         (lbl: string) => `Lavatrice ${lbl} prenotata!`,
    prevHad:        (r: string) => `La stanza ${r} aveva questo turno prima di te — ha già ritirato il bucato?`,
    legendFree:     "Verde — Libera", legendFreeDesc: "Puoi prenotarla subito.",
    legendInUse:    (t: string) => `Giallo — In uso — Turno in corso, fine alle ${t}.`,
    legendPrev:     "Camera — Turno precedente — Indica chi aveva lo slot prima di te.",
    legendOos:      "Rosso — Fuori uso — Segnalata dalla sezione Admin.",
    legendAuto:     "Asciugatrice automatica — prenotando una lavatrice, quella corrispondente viene riservata per il turno successivo.",
    lgFree: "Libera", lgInUse: "In uso", lgOos: "Fuori uso", lgPrev: "Turno precedente",
    lgFreeD: "Puoi prenotarla subito.",
    lgInUseD: (t: string) => `Turno in corso, fine alle ${t}.`,
    lgOosD: "Segnalata dalla sezione Admin.",
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
    welcome:  "Welcome", enterRoom: "Enter your room number to continue",
    skip:     "Continue without logging in",
    machines: "Machines", // <--- AGGIUNTO
    washers:  "Washers", dryers: "Dryers",
    free:     "Free", inUse: "In use", oos: "Out of order", operative: "Operational",
    book:     "Book", reminder: "Remind", sendReminder: "Send reminder", sent: "Sent ✓",
    currentSlot: "Current slot", prevSlot: "Previous slot", now: "now", prev: "prev.",
    yourBookings: "Your bookings",
    inProgressNow: "In progress now",
    noActiveBookings: "No active bookings",
    freeTodayLabel: "free slots today",
    favorites: "Favourites",
    noFavs: "Tap the ★ next to a time in the Daily tab to add it to favourites.",
    favFree: "Free", favFull: "Full", favPast: "Past",
    remainingChip: (n: number) => n >= 0 ? `${n} left` : `${n}`,
    slotEndsIn: "Ends in",
    remainingMsg: (n: number) => n > 0
      ? `You can book ${n} more ${n === 1 ? "slot" : "slots"} this week (max ${WEEKLY_QUOTA} per room).`
      : n === 0
      ? `You've used both your slots this week (max ${WEEKLY_QUOTA} per room).`
      : `You're over the weekly limit of ${WEEKLY_QUOTA} slots (${-n} extra).`,
    howItWorks: "How it works",
    autoWash: (_end: string) => `Corresponding dryer auto-reserved for the next slot.`,
    daily:    "Daily", weekly: "Week", overview: "Overview",
    thisWeek: "Current week",
    confirm:  "Confirm", cancel:  "Cancel", modify: "Edit room", delete: "Delete booking",
    forMe:    (r: string) => `For me — Room ${r}`,
    forOther: "For someone else",
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
    reportOos:      "Report machine out of order",
    restore:        "Restore",
    oosDesc:        "Mark a machine as unavailable or restore it.",
    reminderSent:   (r: string) => `Reminder sent · Room ${r}`,
    oosSet:         (lbl: string) => `${lbl} marked out of order`,
    oosCleared:     (lbl: string) => `${lbl} restored`,
    booked:         (lbl: string) => `Washer ${lbl} booked!`,
    prevHad:        (r: string) => `Room ${r} had this slot before you — have they collected their laundry?`,
    legendFree:     "Green — Free", legendFreeDesc: "Book it now.",
    legendInUse:    (t: string) => `Yellow — In use — Slot ends at ${t}.`,
    legendPrev:     "Room — Previous slot — Shows who had the slot before you.",
    legendOos:      "Red — Out of order — Reported via Admin.",
    legendAuto:     "Auto-dryer — booking a washer automatically reserves the matching dryer for the next slot.",
    lgFree: "Free", lgInUse: "In use", lgOos: "Out of order", lgPrev: "Previous slot",
    lgFreeD: "Book it now.",
    lgInUseD: (t: string) => `In progress, ends at ${t}.`,
    lgOosD: "Reported from the Admin section.",
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
function deriveMachines(week: WeekData, status: StatusData, day: number, slot: number): Machine[] {
  const p  = prevRef(day, slot);
  const pp = prevRef(p.day, p.slot);
  const mk = (id: string, type: MachineType, room?: string, prevRoom?: string): Machine => {
    const st: MachineStatus = status[id] === "oos" ? "out-of-order" : room ? "in-use" : "available";
    return { id, label: id[2], type, status: st, room, prevRoom };
  };
  const out: Machine[] = [];
  for (const L of ["A","B","C"]) {
    const wid = "W-" + L;
    out.push(mk(wid, "washer", bookingAt(week, day, slot, wid), bookingAt(week, p.day, p.slot, wid)));
  }
  for (const L of ["A","B","C"]) {
    const did = "D-" + L, wid = "W-" + L;
    out.push(mk(did, "dryer", bookingAt(week, p.day, p.slot, wid), bookingAt(week, pp.day, pp.slot, wid)));
  }
  return out;
}

// ─── Prenotazioni della propria camera nella settimana ────────────────────────

interface MyBooking { day: number; slot: number; mid: string; }

// Turno preferito: giorno della settimana + slot orario (es. Domenica 14:30–15:45)
interface Fav { day: number; slot: number; }

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

function BookModal({ target, bookings, myRoom, lang, onConfirm, onClose }: {
  target: BookTarget; bookings: WeekData; isDark: boolean; myRoom?: string; lang: Lang;
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
  const sub  = "var(--muted-foreground)";
  const chip = "var(--secondary)";
  const machLabel = selMachine?.split("-")[1] ?? "";

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

        {step === "pick" && (
          <>
            <p className="text-sm font-semibold mb-3" style={{ color:fg }}>{t.chooseFree}</p>
            <div className="flex gap-3 mb-4">
              {["W-A","W-B","W-C"].map((id) => {
                const isTaken = taken.has(id);
                return (
                  <button key={id} disabled={isTaken}
                    onClick={() => { setSelMachine(id); setStep("input"); }}
                    className="flex-1 flex flex-col items-center gap-2 rounded-2xl py-4 transition-all active:scale-95 border"
                    style={{ background:chip, borderColor: isTaken ? "transparent" : "var(--border)", opacity:isTaken?0.32:1, cursor:isTaken?"not-allowed":"pointer" }}>
                    <WashingMachine size={22} style={{ color:isTaken?sub:fg }}/>
                    <span className="text-sm font-bold font-mono" style={{ color:isTaken?sub:fg }}>Lav. {id[2]}</span>
                    <span className="text-[10px]" style={{ color:isTaken?sub:GREEN }}>{isTaken ? t.occupied : t.free}</span>
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
                <span>{t.forMe(myRoom)}</span>
                <span style={{ opacity:0.7 }}>→</span>
              </button>
              <button
                onClick={()=>setStep("input")}
                className="w-full py-4 rounded-2xl text-sm font-semibold flex items-center justify-between px-5 transition-all active:scale-[0.98]"
                style={{ background:chip, color:fg }}>
                <span>{t.forOther}</span>
                <span style={{ color:sub }}>→</span>
              </button>
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
              {["1","2","3","4","5","6","7","8","9"].map((k)=>(
                <button key={k} onClick={()=>room.length<4&&setRoom(room+k)}
                  className="rounded-2xl h-12 text-lg font-bold transition-all active:scale-95"
                  style={{ background:chip, color:fg }}>{k}</button>
              ))}
              <button onClick={()=>setRoom(room.slice(0,-1))}
                className="rounded-2xl h-12 flex items-center justify-center transition-all active:scale-95"
                style={{ background:chip, color:sub }}><Delete size={18}/></button>
              <button onClick={()=>room.length<4&&setRoom(room+"0")}
                className="rounded-2xl h-12 text-lg font-bold transition-all active:scale-95"
                style={{ background:chip, color:fg }}>0</button>
              <button onClick={()=>room.length>0&&setStep("confirm")}
                className="rounded-2xl h-12 text-lg font-bold transition-all active:scale-95"
                style={{ background:room.length>0?RED:chip, color:room.length>0?RED_FG:sub }}>→</button>
            </div>
            {(target.machineId === "?" || myRoom) && (
              <button onClick={()=>setStep(target.machineId==="?"?"pick":myRoom?"owner":"input")} className="text-xs" style={{ color:sub }}>{t.back}</button>
            )}
          </>
        )}

        {step === "confirm" && (
          <>
            <p className="text-sm font-semibold mb-1" style={{ color:fg }}>{t.confirmBooking}</p>
            <p className="text-xs mb-4" style={{ color:sub }}>{t.room} {room} · Lavatrice {machLabel}</p>
            <div className="rounded-2xl overflow-hidden mb-5 border" style={{ borderColor: "var(--border)" }}>
              <div className="p-4 flex items-center gap-3" style={{ background: "color-mix(in srgb, var(--primary) 12%, transparent)" }}>
                <div className="p-2.5 rounded-xl" style={{ background:RED, color:RED_FG }}><WashingMachine size={18}/></div>
                <div>
                  <p className="text-xs font-mono mb-0.5" style={{ color:sub }}>Lavatrice {machLabel} · {t.room} {room}</p>
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
  const sub  = "var(--muted-foreground)";
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

// ─── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ lang, week, status, roomNumber, favs, onToggleFav, onBook, onClear, onStatus }: {
  theme: Theme; lang: Lang; week: WeekData; status: StatusData; roomNumber: string;
  favs: Fav[]; onToggleFav: (day:number, slot:number)=>void;
  onBook: (day:number, slot:number, machine:string, room:string)=>Promise<void>;
  onClear: (day:number, slot:number, machine:string)=>Promise<void>;
  onStatus: (machine:string, oos:boolean)=>Promise<void>;
}) {
  const t = T[lang];
  const [now, setNow]           = useState(new Date());
  const [toast, setToast]       = useState<string | null>(null);
  const [booking, setBooking]   = useState<Machine | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);

  const fg   = "var(--foreground)";
  const sub  = "var(--muted-foreground)";
  const surf = "var(--card)";
  const div  = "var(--border)";

  useEffect(() => { const id = setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(id); },[]);

  const machines = deriveMachines(week, status, TODAY_DOW, CUR_SLOT);

  async function confirmBooking(m: Machine, room: string) {
    try { await onBook(TODAY_DOW, CUR_SLOT, m.id, room); setBooking(null); setToast(t.booked(m.label)); }
    catch (e) { setBooking(null); setToast(errMsg(e, lang)); }
  }

  const slot       = TIME_SLOTS[CUR_SLOT];
  const slotEndsMs = slotEndDate(CUR_SLOT).getTime() - now.getTime();
  
  const myBookings     = myWeekBookings(week, roomNumber);
  const remaining      = WEEKLY_QUOTA - myBookings.length;
  const activeBookings = myBookings.filter((b) => !isPastBooking(b));

  // Prima lavatrice libera in un dato (giorno, slot)
  const firstFreeWasherAt = (day: number, s: number): string | null =>
    ["W-A","W-B","W-C"].find((wid) => status[wid] !== "oos" && !week[day]?.[s]?.[wid]) ?? null;

  async function quickBook(day: number, s: number, mid: string) {
    if (!roomNumber) return;
    try { await onBook(day, s, mid, roomNumber); setToast(t.booked(mid[2])); }
    catch (e) { setToast(errMsg(e, lang)); }
  }

  async function cancelBooking(b: MyBooking) {
    try { await onClear(b.day, b.slot, b.mid); setToast(t.slotDeleted); }
    catch (e) { setToast(errMsg(e, lang)); }
  }

  // Lavatrice + asciugatrice trattate come un'unica unità (A/B/C): mostriamo la lavatrice
  // prenotabile; l'asciugatrice abbinata è implicita (auto-riservata dal backend).
  const washers = machines.filter((m) => m.type === "washer");

  return (
    <div className="flex flex-col pb-6">
      {toast     && <Toast msg={toast} onClose={()=>setToast(null)}/>}
      {adminOpen && <AdminSheet lang={lang} status={status} onStatus={onStatus} onClose={()=>setAdminOpen(false)}/>}
      {booking && (
        <BookModal
          target={{ slotIdx:CUR_SLOT, machineId:booking.id }}
          bookings={week}
          isDark={false}
          lang={lang}
          myRoom={roomNumber}
          onConfirm={(r)=>confirmBooking(booking,r)}
          onClose={()=>setBooking(null)}
        />
      )}

      {/* Header */}
      <div className="px-5 pt-6 pb-5">
        <div className="text-center mb-4">
          <p className="text-[11px] font-mono tracking-widest uppercase mb-1.5" style={{ color:sub }}>{fmtDay(now, lang)}</p>
          <p className="text-4xl font-bold tabular-nums font-mono leading-none mb-1.5" style={{ color:fg }}>{fmtTime(now, lang)}</p>
          <p className="text-sm" style={{ color:sub }}>
            {t.greeting(now.getHours())}{roomNumber ? <>, {t.camera} <span style={{ color:fg, fontWeight:600 }}>{roomNumber}</span></> : ""}
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

      <div className="lg:grid lg:grid-cols-2 lg:gap-x-5 lg:items-start">
      <div className="lg:flex lg:flex-col">

      {/* Le tue prenotazioni */}
      {roomNumber && (
        <section className="px-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-mono tracking-widest uppercase" style={{ color:sub }}>{t.yourBookings}</p>
            <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-full"
              style={{
                background: remaining > 0 ? `color-mix(in srgb, ${GREEN} 15%, transparent)`
                          : remaining === 0 ? "var(--secondary)"
                          : `color-mix(in srgb, ${ORANGE} 18%, transparent)`,
                color: remaining > 0 ? GREEN : remaining === 0 ? sub : ORANGE,
              }}>
              {t.remainingChip(remaining)}
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
              <CalendarDays size={12} style={{ color: remaining >= 0 ? sub : ORANGE, flexShrink:0 }}/>
              <p className="text-[11px]" style={{ color: remaining >= 0 ? sub : ORANGE }}>{t.remainingMsg(remaining)}</p>
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
        <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.favorites}</p>
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
                  {freeMid && roomNumber && (
                    <button onClick={()=>quickBook(f.day, f.slot, freeMid)}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 shrink-0"
                      style={{ background:`color-mix(in srgb, ${GREEN} 18%, transparent)`, color:GREEN }}>
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

      <div className="lg:flex lg:flex-col">

      {/* Macchine — lavatrice+asciugatrice come unica unità A/B/C */}
      <section className="px-5 mb-4">
        <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.machines}</p>
        <div className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
          {washers.map((m, i) => (
            <MachineRow key={m.id} machine={m} lang={lang} combo
              isLast={i === washers.length - 1} divColor={div}
              onBook={() => setBooking(m)}/>
          ))}
        </div>
      </section>

      {/* Legenda */}
      <section className="px-5 pt-2">
        <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.howItWorks}</p>
        <div className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
          {[
            { dot:GREEN,  name:t.lgFree,  desc:t.lgFreeD },
            { dot:YELLOW, name:t.lgInUse, desc:t.lgInUseD(TIME_SLOTS[CUR_SLOT].end) },
            { dot:OOS_C,  name:t.lgOos,   desc:t.lgOosD },
            { icon:true,  name:t.lgPrev,  desc:t.lgPrevD },
          ].map(({ dot, icon, name, desc }, i, arr) => (
            <div key={name} className="px-4 py-3"
              style={{ borderBottom: i < arr.length - 1 ? `1px solid ${div}` : "none" }}>
              {/* Colore/icona + nome stato sopra */}
              <div className="flex items-center gap-2 mb-1">
                {icon
                  ? <BedDouble size={13} className="shrink-0" style={{ color:ORANGE }}/>
                  : <span className="size-2.5 rounded-full shrink-0" style={{ background:dot }}/>}
                <p className="text-xs font-semibold" style={{ color: fg }}>{name}</p>
              </div>
              {/* Spiegazione in grigio chiaro, sotto al colore */}
              <p className="text-xs" style={{ color: "color-mix(in srgb, var(--foreground) 50%, transparent)" }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Admin trigger */}
      <div className="px-5 pt-3 pb-1">
        <button
          onClick={() => setAdminOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-medium transition-all active:scale-[0.98] border"
          style={{ background: "var(--secondary)", color:sub, borderColor: "var(--border)" }}>
          <Wrench size={14}/>
          {t.reportOos}
        </button>
      </div>

      </div>{/* ── fine colonna 2 (macchine) ── */}
      </div>{/* ── fine griglia desktop ── */}
    </div>
  );
}

function MachineRow({ machine, lang, isLast, divColor, onBook, combo = false }: {
  machine: Machine; lang: Lang; isLast: boolean; divColor: string; onBook:()=>void; combo?: boolean;
}) {
  const t = T[lang];
  const fg  = "var(--foreground)";

  const isFree  = machine.status === "available";
  const isInUse = machine.status === "in-use";
  const isOOO   = machine.status === "out-of-order";

  const dotColor = isOOO ? OOS_C : isFree ? GREEN : YELLOW;
  const rowBg = isFree ? `color-mix(in srgb, ${GREEN} 6%, transparent)` : "transparent";

  return (
    <div style={{ borderBottom:isLast?"none":`1px solid ${divColor}`, background:rowBg }}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Dot + icona/e + label (combo = lavatrice+asciugatrice come unica unità) */}
        <div className={`flex items-center gap-2.5 shrink-0 ${combo ? "w-20" : "w-16"}`}>
          <span className="size-2 rounded-full shrink-0" style={{ background:dotColor }}/>
          <div className="flex items-center gap-1" style={{ color:fg }}>
            {combo
              ? <span className="flex items-center gap-0.5"><WashingMachine size={16}/><Wind size={13} style={{ opacity:0.5 }}/></span>
              : machine.type==="washer" ? <WashingMachine size={16}/> : <Wind size={15}/>}
            <span className="text-base font-mono font-bold">{machine.label}</span>
          </div>
        </div>

        {/* Status */}
        <div className="flex-1 min-w-0">
          {isFree  && <p className="text-sm font-semibold" style={{ color:GREEN }}>{t.free}</p>}
          {isInUse && <p className="text-sm font-medium"   style={{ color:fg }}>{t.room} {machine.room}</p>}
          {isOOO   && <p className="text-sm font-medium"   style={{ color:OOS_C }}>{t.oos}</p>}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {machine.prevRoom && (
            <span className="flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-semibold"
              style={{ background:`color-mix(in srgb, ${ORANGE} 12%, transparent)`, color:ORANGE }}>
              <BedDouble size={13}/>
              <span className="text-[11px] font-mono">{machine.prevRoom}</span>
            </span>
          )}
          {isFree && machine.type==="washer" && (
            <button onClick={onBook}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95"
              style={{ background:`color-mix(in srgb, ${GREEN} 18%, transparent)`, color:GREEN }}>
              <Plus size={12}/>{t.book}
            </button>
          )}
          {isOOO && <AlertTriangle size={15} style={{ color:OOS_C }}/>}
        </div>
      </div>
    </div>
  );
}

// ─── Day Schedule ──────────────────────────────────────────────────────────────

function DaySchedule({ lang, week, roomNumber: sessionRoom, favs, onToggleFav, onBook, onClear }: {
  theme: Theme; lang: Lang; week: WeekData; roomNumber: string;
  favs: Fav[]; onToggleFav: (day:number, slot:number)=>void;
  onBook: (day:number, slot:number, machine:string, room:string)=>Promise<void>;
  onClear: (day:number, slot:number, machine:string)=>Promise<void>;
}) {
  const t = T[lang];
  const [selDay, setSelDay]       = useState(TODAY_DOW);
  const [target, setTarget]       = useState<BookTarget | null>(null);
  const [modTarget, setModTarget] = useState<ModifyTarget | null>(null);
  const [toast, setToast]         = useState<string | null>(null);

  const fg  = "var(--foreground)";
  const sub = "var(--muted-foreground)";
  const hdr = "var(--muted)";
  const div = "var(--border)";
  const dayData = week[selDay] ?? {};

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

  return (
    <div className="flex flex-col h-full lg:max-w-3xl lg:mx-auto lg:w-full">
      {toast     && <Toast msg={toast} onClose={()=>setToast(null)}/>}
      {target    && <BookModal target={{...target,dayIdx:selDay}} bookings={week} isDark={false} lang={lang} myRoom={sessionRoom} onConfirm={confirmBooking} onClose={()=>setTarget(null)}/>}
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
        {["W-A","W-B","W-C"].map((id)=>(
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
              {["W-A","W-B","W-C"].map((mid) => {
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
                        {!isPast && <Plus size={10} style={{ color:"var(--muted-foreground)", opacity:0.6 }}/>}
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

function SlotDetailSheet({ target, bookings, lang, onBook, onModify, onDelete, onClose }: {
  target: SlotDetailTarget;
  bookings: WeekData;
  isDark: boolean;
  lang: Lang;
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
  const sub      = "var(--muted-foreground)";
  const chip     = "var(--secondary)";
  const divC     = "var(--border)";

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
          {["W-A","W-B","W-C"].map((mid) => {
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

function WeekOverview({ lang, week, roomNumber: sessionRoom, onBook, onClear }: {
  theme: Theme; lang: Lang; week: WeekData; roomNumber: string;
  onBook: (day:number, slot:number, machine:string, room:string)=>Promise<void>;
  onClear: (day:number, slot:number, machine:string)=>Promise<void>;
}) {
  const t = T[lang];
  const [target, setTarget]           = useState<BookTarget | null>(null);
  const [modTarget, setModTarget]     = useState<ModifyTarget | null>(null);
  const [slotDetail, setSlotDetail]   = useState<SlotDetailTarget | null>(null);
  const [toast, setToast]             = useState<string | null>(null);

  const fg  = "var(--foreground)";
  const sub = "var(--muted-foreground)";
  const div = "var(--border)";
  const hdr = "var(--muted)";
  const DAY_W = 68;
  const TIME_W = 48;

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

  return (
    <div className="flex flex-col h-full lg:max-w-4xl lg:mx-auto lg:w-full">
      {toast      && <Toast msg={toast} onClose={()=>setToast(null)}/>}
      {target     && <BookModal target={target} bookings={week} isDark={false} lang={lang} myRoom={sessionRoom} onConfirm={confirmBooking} onClose={()=>setTarget(null)}/>}
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
        <div style={{ minWidth: TIME_W + DAY_W * 7 }}>

          <div className="flex" style={{ position:"sticky", top:0, zIndex:3, background:hdr, borderBottom:`1px solid ${div}` }}>
            <div style={{ width:TIME_W, flexShrink:0, position:"sticky", left:0, zIndex:4, background:hdr }}
              className="flex items-end justify-center pb-2">
              <span className="text-[8px] font-mono uppercase" style={{ color:sub }}>{t.now}</span>
            </div>
            {t.days.map((d, i) => {
              const isToday = i===TODAY_DOW;
              const isPast  = i<TODAY_DOW;
              return (
                <div key={d} className="shrink-0 flex flex-col items-center py-2 gap-0.5" style={{ width:DAY_W }}>
                  <span className="text-[9px] font-mono uppercase" style={{ color:isToday?RED:isPast?`color-mix(in srgb, var(--muted-foreground) 40%, transparent)`:sub }}>{d}</span>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background:isToday?RED:"transparent" }}>
                    <span className="text-sm font-bold" style={{ color:isToday?RED_FG:isPast?`color-mix(in srgb, var(--muted-foreground) 40%, transparent)`:sub }}>{DAYS_DATE[i]}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {TIME_SLOTS.map((slot, si) => (
            <div key={slot.start} className="flex" style={{ borderBottom:`1px solid ${div}` }}>
              <div style={{ width:TIME_W, flexShrink:0, position:"sticky", left:0, zIndex:1, background:hdr, minHeight:60 }}
                className="flex items-start justify-end pr-2 pt-1.5">
                <span className="text-[9px] font-mono tabular-nums" style={{ color:sub }}>{slot.start}</span>
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
                    className="relative flex flex-col justify-start pt-1 px-1 gap-0.5 shrink-0 text-left transition-colors border-l"
                    style={{ width:DAY_W, minHeight:60, background:isCur?`color-mix(in srgb, var(--primary) 8%, transparent)`:isPrevSl?`color-mix(in srgb, var(--chart-4) 5%, transparent)`:"transparent", borderColor:div, opacity:isPast?0.38:1, cursor:isPast?"default":"pointer" }}>
                    {isCur    && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background:RED }}/>}
                    {isPrevSl && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background:ORANGE }}/>}
                    {rooms.map(([mid, room]) => {
                      const isMe = !!sessionRoom && room === sessionRoom;
                      return (
                        <div key={mid} className="rounded-md px-1 py-0.5 flex items-center gap-1 w-full border"
                          style={{
                            background: isMe ? RED : "var(--secondary)",
                            borderColor: isMe ? RED : "var(--border)",
                          }}>
                          <span className="text-[8px] font-mono font-bold shrink-0" style={{ color:isMe?RED_FG:sub }}>{mid[2]}</span>
                          <span className="text-[8px] font-mono truncate" style={{ color:isMe?RED_FG:fg }}>{room}</span>
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

function AdminSheet({ lang, status, onStatus, onClose }: {
  theme?: Theme; lang: Lang; status: StatusData;
  onStatus: (machine:string, oos:boolean)=>Promise<void>; onClose: () => void;
}) {
  const t = T[lang];
  const [toast, setToast] = useState<string | null>(null);
  const bg   = "var(--background)";
  const fg   = "var(--foreground)";
  const sub  = "var(--muted-foreground)";
  const surf = "var(--card)";
  const div  = "var(--border)";

  const mk = (id: string, type: MachineType): Machine => ({
    id, label: id[2], type, status: status[id] === "oos" ? "out-of-order" : "available",
  });
  const washers: Machine[] = ["W-A","W-B","W-C"].map((id)=>mk(id,"washer"));
  const dryers:  Machine[] = ["D-A","D-B","D-C"].map((id)=>mk(id,"dryer"));

  async function toggle(m: Machine) {
    const goingOos = m.status !== "out-of-order";
    try { await onStatus(m.id, goingOos); setToast(goingOos ? t.oosSet(m.label) : t.oosCleared(m.label)); }
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
              <AdminRow key={m.id} machine={m} lang={lang} isLast={i===washers.length-1} divColor={div} onToggle={()=>toggle(m)} />
            ))}
          </div>
        </div>

        <div className="px-5">
          <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.dryers}</p>
          <div className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
            {dryers.map((m, i) => (
              <AdminRow key={m.id} machine={m} lang={lang} isLast={i===dryers.length-1} divColor={div} onToggle={()=>toggle(m)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminRow({ machine, lang, isLast, divColor, onToggle }: {
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
      <button onClick={onToggle}
        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold shrink-0 transition-all active:scale-95"
        style={isOOO
          ? { background:`color-mix(in srgb, ${GREEN} 12%, transparent)`, color:GREEN }
          : { background:`color-mix(in srgb, var(--destructive) 12%, transparent)`, color:OOS_C }}>
        {isOOO ? <><RotateCcw size={12}/>{t.restore}</> : <><Wrench size={12}/>{t.oos}</>}
      </button>
    </div>
  );
}

// ─── Login screen ─────────────────────────────────────────────────────────────

function LoginScreen({ lang, onLogin }: { theme?: Theme; lang: Lang; onLogin: (room: string) => void }) {
  const t = T[lang];
  const [room, setRoom] = useState("");
  const fg   = "var(--foreground)";
  const sub  = "var(--muted-foreground)";
  const chip = "var(--secondary)";
  const surf = "var(--card)";

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

      <div className="grid grid-cols-3 gap-2.5 w-full mb-4">
        {["1","2","3","4","5","6","7","8","9"].map((k)=>(
          <button key={k} onClick={()=>room.length<4&&setRoom(room+k)}
            className="rounded-2xl h-14 text-xl font-bold transition-all active:scale-95"
            style={{ background:chip, color:fg }}>{k}</button>
        ))}
        <button onClick={()=>setRoom(room.slice(0,-1))}
          className="rounded-2xl h-14 flex items-center justify-center transition-all active:scale-95"
          style={{ background:chip, color:sub }}><Delete size={20}/></button>
        <button onClick={()=>room.length<4&&setRoom(room+"0")}
          className="rounded-2xl h-14 text-xl font-bold transition-all active:scale-95"
          style={{ background:chip, color:fg }}>0</button>
        <button onClick={()=>room.length>0&&onLogin(room)}
          className="rounded-2xl h-14 text-xl font-bold transition-all active:scale-95 text-white"
          style={{ background:room.length>0?RED:chip, color:room.length>0?RED_FG:sub }}>→</button>
      </div>

      <button
        onClick={()=>onLogin("")}
        className="w-full py-3.5 rounded-2xl text-sm font-medium transition-all active:scale-[0.98] border"
        style={{ borderColor:"var(--border)", color:sub, background:"transparent" }}>
        {t.skip}
      </button>
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
    <div className="flex shrink-0 border-t" style={{ background:"var(--background)", borderColor:"var(--border)" }}>
      {tabs.map((tab,i)=>{ const Icon=tab.icon; return (
        <button key={i} onClick={()=>onChange(i)} className="flex-1 flex flex-col items-center gap-1 py-3 transition-colors"
          style={{ color:active===i?RED:"var(--muted-foreground)" }}>
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

function DesktopSidebar({ active, onChange, lang, theme, roomNumber, showNav, facility, onFacility, onChangeRoom, onToggleLang, onToggleTheme }: {
  active: number; onChange: (i: number) => void; lang: Lang; theme: Theme;
  roomNumber: string | null; showNav: boolean;
  facility: Facility; onFacility: (f: Facility) => void;
  onChangeRoom: () => void; onToggleLang: () => void; onToggleTheme: () => void;
}) {
  const t   = T[lang];
  const fg  = "var(--foreground)";
  const sub = "var(--muted-foreground)";
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
        <span className="text-lg font-bold" style={{ color:fg }}>Collegio</span>
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
      </nav>

      {/* Controlli */}
      <div className="px-3 py-4 border-t flex flex-col gap-2 shrink-0" style={{ borderColor:div }}>
        {roomNumber !== null && (
          <button onClick={onChangeRoom}
            className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors desk-nav"
            style={{ color:fg }}>
            <span className="font-mono">{roomNumber ? `St. ${roomNumber}` : t.changeRoom}</span>
            <RotateCcw size={13} style={{ color:sub }}/>
          </button>
        )}
        <div className="flex gap-2">
          <button onClick={onToggleLang}
            className="flex-1 rounded-xl py-2 text-xs font-mono font-bold transition-colors"
            style={{ background:"var(--secondary)", color:fg }}>
            {lang==="it"?"EN":"IT"}
          </button>
          <button onClick={onToggleTheme}
            className="flex-1 rounded-xl py-2 flex items-center justify-center transition-colors"
            style={{ background:"var(--secondary)", color:sub }}>
            {theme==="dark" ? <Sun size={15}/> : <Moon size={15}/>}
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─── Stati di caricamento / errore ─────────────────────────────────────────────

function CenterState({ children }: { isDark?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4"
      style={{ color:"var(--muted-foreground)" }}>
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

function FacilitySwitcher({ facility, onChange, lang }: { facility: Facility; onChange: (f: Facility)=>void; lang: Lang }) {
  return (
    <div className="flex gap-1.5 px-5 pt-3 pb-1 shrink-0">
      {FACILITIES.map(({ id, icon: Icon, label }) => {
        const active = facility === id;
        return (
          <button key={id} onClick={()=>onChange(id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 border"
            style={active
              ? { background:RED, color:RED_FG, borderColor:RED }
              : { background:"var(--secondary)", color:"var(--muted-foreground)", borderColor:"var(--border)" }}>
            <Icon size={14}/>{label[lang]}
          </button>
        );
      })}
    </div>
  );
}

// ─── Campanello promemoria push ────────────────────────────────────────────────
function ReminderBell({ room, lang }: { room: string | null; lang: Lang }) {
  const [state, setState] = useState<push.ReminderState>("unknown");
  const [busy, setBusy]   = useState(false);

  useEffect(() => { push.getReminderState().then(setState); }, []);

  if (!push.pushSupported() || !room) return null;

  const on = state === "on";
  const label = lang === "it"
    ? (state === "denied" ? "Notifiche bloccate nelle impostazioni del browser"
       : on ? "Promemoria turni attivi (tocca per disattivare)"
            : "Attiva promemoria 15 min prima del turno")
    : (state === "denied" ? "Notifications blocked in browser settings"
       : on ? "Shift reminders on (tap to turn off)"
            : "Turn on a reminder 15 min before your shift");

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (on) { await push.disableReminders(); setState("off"); }
      else    { await push.enableReminders(room!); setState(await push.getReminderState()); }
    } catch (e: any) {
      if (String(e?.message) === "denied") setState("denied");
    } finally { setBusy(false); }
  }

  return (
    <button onClick={toggle} disabled={busy} title={label} aria-label={label}
      className="p-1.5 rounded-lg transition-colors"
      style={{ color: on ? RED : "var(--muted-foreground)", opacity: busy ? 0.5 : 1 }}>
      {on ? <BellRing size={13}/> : <Bell size={13}/>}
    </button>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]   = useState(0);
  const [facility, setFacility] = useState<Facility>("laundry");
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("laundryhub.theme");
      // Se c'è un salvataggio valido lo usiamo, altrimenti di default "dark"
      return (saved === "light" || saved === "dark") ? saved : "light";
    } catch {
      return "light";
    }
  });
  const [lang,   setLang]     = useState<Lang>("it");
  const [roomNumber, setRoomNumber] = useState<string | null>(() => {
    try { return localStorage.getItem("laundryhub.room"); } catch { return null; }
  });
  const [week,   setWeek]     = useState<WeekData>({});
  const [status, setStatus]   = useState<StatusData>({});
  const [loading, setLoading] = useState(true);
  const [error,  setError]    = useState<string | null>(null);
  const [favs,   setFavs]     = useState<Fav[]>(() => {
    // Nuovo formato preferiti: {day, slot}. Il vecchio formato (solo numeri) viene scartato.
    try {
      const raw = JSON.parse(localStorage.getItem("laundryhub.favs") || "[]");
      return Array.isArray(raw) ? raw.filter((x: any) => x && typeof x.day === "number" && typeof x.slot === "number") : [];
    } catch { return []; }
  });
  const t = T[lang];

  const toggleFav = useCallback((day: number, slot: number) => {
    setFavs((prev) => {
      const exists = prev.some((f) => f.day === day && f.slot === slot);
      const next = exists
        ? prev.filter((f) => !(f.day === day && f.slot === slot))
        : [...prev, { day, slot }].sort((a, b) => a.day - b.day || a.slot - b.slot);
      try { localStorage.setItem("laundryhub.favs", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    // Salviamo la preferenza ogni volta che cambia
    try { localStorage.setItem("laundryhub.theme", theme); } catch {}
  }, [theme]);
  
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

  function chooseRoom(room: string) {
    try { localStorage.setItem("laundryhub.room", room); } catch {}
    setRoomNumber(room);
  }
  function changeRoom() { setRoomNumber(null); }

  const handleBook = useCallback(async (day:number, slot:number, machine:string, room:string) => {
    const s = await api.book(day, slot, machine, room); setWeek(s.week); setStatus(s.status);
  }, []);
  const handleClear = useCallback(async (day:number, slot:number, machine:string) => {
    const s = await api.clearBooking(day, slot, machine); setWeek(s.week); setStatus(s.status);
  }, []);
  const handleStatus = useCallback(async (machine:string, oos:boolean) => {
    const st = await api.setStatus(machine, oos); setStatus(st);
  }, []);

  const showChrome = roomNumber !== null && !loading && !error;
  const isDesktop  = useMediaQuery("(min-width: 1024px)");

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
      <button onClick={()=>{ setLoading(true); refresh(); }}
        className="mt-1 rounded-xl px-4 py-2 text-sm font-semibold" style={{ background:RED, color:RED_FG }}>
        {t.retry}
      </button>
    </CenterState>
  ) : roomNumber === null ? (
    <LoginScreen lang={lang} onLogin={chooseRoom}/>
  ) : (
    <>
      {screen===0 && <Dashboard   theme={theme} lang={lang} week={week} status={status} roomNumber={roomNumber} favs={favs} onToggleFav={toggleFav} onBook={handleBook} onClear={handleClear} onStatus={handleStatus}/>}
      {screen===1 && <DaySchedule theme={theme} lang={lang} week={week} roomNumber={roomNumber} favs={favs} onToggleFav={toggleFav} onBook={handleBook} onClear={handleClear}/>}
      {screen===2 && <WeekOverview theme={theme} lang={lang} week={week} roomNumber={roomNumber} onBook={handleBook} onClear={handleClear}/>}
    </>
  );

  // Lavanderia → schermate laundry; Cinema/Musica → sala a fasce libere
  const isRoom = facility !== "laundry";
  const bodyContent = isRoom ? <RoomView room={facility as "cinema" | "music"} lang={lang}/> : mainContent;

  if (isDesktop) {
    return (
      <div className="relative h-dvh w-full flex overflow-hidden"
        style={{ fontFamily:"'DM Sans', sans-serif", background:"var(--background)" }}>
        {globalStyle}
        <DesktopSidebar
          active={screen} onChange={setScreen} lang={lang} theme={theme}
          roomNumber={roomNumber} showNav={showChrome}
          facility={facility} onFacility={setFacility}
          onChangeRoom={changeRoom}
          onToggleLang={()=>setLang(l=>l==="it"?"en":"it")}
          onToggleTheme={()=>setTheme(theme === "dark" ? "light" : "dark")}
        />
        <main className="flex-1 h-dvh min-h-0 flex flex-col overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-5xl flex-1 min-h-0 flex flex-col">
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

        <div className="flex items-center justify-between px-7 pt-3 pb-0 shrink-0 mt-2 md:mt-0">
          {roomNumber !== null ? (
            <button onClick={changeRoom}
              className="text-[11px] font-mono px-2 py-1 rounded-lg transition-colors"
              style={{ background:"var(--secondary)", color:"var(--muted-foreground)" }}>
              {roomNumber ? `St. ${roomNumber}` : t.changeRoom}
            </button>
          ) : (
            <span className="text-[11px] font-mono" style={{ color:"var(--muted-foreground)" }}>9:41</span>
          )}
          <div className="w-24 h-6 rounded-full hidden md:flex items-center justify-center" style={{ background:"var(--secondary)" }}>
            <div className="w-3 h-3 rounded-full border" style={{ background:"var(--background)", borderColor:"var(--border)" }}/>
          </div>
          <div className="flex items-center gap-1.5">
            <ReminderBell room={roomNumber} lang={lang} />
            <button onClick={()=>setLang(l=>l==="it"?"en":"it")}
              className="rounded-lg px-2 py-1 text-[10px] font-mono font-bold transition-colors"
              style={{ background:"var(--secondary)", color:"var(--foreground)" }}>
              {lang==="it"?"EN":"IT"}
            </button>
            <button onClick={()=>setTheme(theme === "dark" ? "light" : "dark")} className="p-1.5 rounded-lg" style={{ color:"var(--muted-foreground)" }}>
              {theme === "dark" ? <Sun size={13}/> : <Moon size={13}/>}
            </button>
          </div>
        </div>

        {showChrome && <FacilitySwitcher facility={facility} onChange={setFacility} lang={lang}/>}

        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 flex flex-col mt-2">
          {bodyContent}
        </div>

        {showChrome && !isRoom && <BottomNav active={screen} onChange={setScreen} theme={theme} lang={lang}/>}
        <div className="pb-2 hidden md:flex justify-center shrink-0">
          <div className="w-28 h-1 rounded-full" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        </div>
      </div>
    </div>
  );
}