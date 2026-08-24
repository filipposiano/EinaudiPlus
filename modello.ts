// modello.ts — le regole della lavanderia, senza interfaccia.
//
// Qui c'è solo COME funziona la lavanderia: quanti turni ci sono, quando
// iniziano, quali macchine esistono in quale edificio, quali turni appartengono
// a una camera. Nessun colore, nessuna traduzione, nessun componente — così si
// può leggere (e cambiare) senza aprire le 2000 righe di App.tsx, e si può
// verificare a mente guardando solo questo file.
//
// Regola pratica: se una cosa cambierebbe perché è cambiata la lavanderia
// (hanno aggiunto una macchina, i turni durano 90 minuti), va qui. Se
// cambierebbe perché è cambiata l'app, no.

import * as api from "./api";

// ─── Tipi ────────────────────────────────────────────────────────────────────

export type MachineStatus = "available" | "in-use" | "out-of-order";
export type MachineType   = "washer" | "dryer";

export type WeekData   = api.WeekData;
export type StatusData = api.StatusData;

export interface Machine {
  id: string; label: string; type: MachineType; status: MachineStatus;
  room?: string; prevRoom?: string; prevNudgeSent?: boolean;
}

/** Un turno prenotato dalla propria camera. */
export interface MyBooking { day: number; slot: number; mid: string; }

/** Turno preferito: giorno + fascia oraria (es. domenica 14:30–15:45). */
export interface Fav { day: number; slot: number; }

// ─── Turni ───────────────────────────────────────────────────────────────────
//
// 19 turni da 75 minuti, dalle 07:00 alle 06:45 del giorno dopo. L'ultimo
// scavalca la mezzanotte: è il motivo per cui in giro si vedono conti su
// `% 1440` invece di ore normali.

export const N_SLOTS = 19;

function buildSlots() {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (x: number) => { const m = ((x % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
  const out: { start: string; end: string }[] = [];
  let m = 7 * 60;
  for (let i = 0; i < N_SLOTS; i++) { out.push({ start: fmt(m), end: fmt(m + 75) }); m += 75; }
  return out;
}

export const TIME_SLOTS = buildSlots();

/**
 * Quota settimanale per camera.
 *
 * È un'indicazione, non un limite: il server NON la applica. Senza un login
 * vero la camera è autodichiarata in localStorage, quindi un blocco si
 * aggirerebbe cambiando una stringa nel browser e fermerebbe solo chi lo
 * rispettava già. Alla Direzione non si applica affatto.
 */
export const WEEKLY_QUOTA = 2;

export const APP_VERSION = "0.9.4";

// ─── "Adesso" ────────────────────────────────────────────────────────────────
//
// Calcolati UNA VOLTA all'avvio, non a ogni render: sono la fotografia del
// momento in cui l'app è stata aperta. È anche il motivo per cui l'app si
// ricarica da sola quando torna in primo piano dopo più di cinque minuti —
// altrimenti a mezzanotte mostrerebbe ancora il giorno prima.

function nowInfo(d = new Date()) {
  let mins = d.getHours() * 60 + d.getMinutes();
  let shift = 0;
  // Prima delle 07:00 si appartiene ancora alla "giornata" precedente.
  if (mins < 7 * 60) { shift = -1; mins += 1440; }
  const since7 = mins - 7 * 60;
  let slot = Math.floor(since7 / 75);
  if (slot > N_SLOTS - 1) slot = N_SLOTS - 1;
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate() + shift);
  const dow  = (base.getDay() + 6) % 7;
  const early = (since7 - slot * 75) < 20;
  return { dayIdx: dow, slotIdx: slot, early, base };
}

export const NOW       = nowInfo();
export const TODAY_DOW = NOW.dayIdx;
export const CUR_SLOT  = NOW.slotIdx;
export const PREV_SLOT = CUR_SLOT - 1;

const MONDAY = new Date(NOW.base.getFullYear(), NOW.base.getMonth(), NOW.base.getDate() - TODAY_DOW);
export const WEEK_DATES = Array.from({ length: 7 }, (_, i) => new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate() + i));
export const DAYS_DATE  = WEEK_DATES.map((d) => d.getDate());

/**
 * Il mese abbreviato di un giorno della settimana corrente ("21 ago").
 *
 * I nomi arrivano da fuori invece di stare qui: il calendario è di questo
 * file, le parole sono di i18n.ts. Tenerli qui dentro voleva dire che
 * `modello` doveva conoscere le lingue — e visto che i18n importa già
 * WEEKLY_QUOTA da qui, sarebbe stato un anello circolare.
 */
export const monShort = (i: number, mesi: readonly string[]) => mesi[WEEK_DATES[i].getMonth()];

/** Quando finisce un turno, come Date. */
export function slotEndDate(slotIdx: number) {
  const d = new Date(NOW.base);
  d.setMinutes(d.getMinutes() + 7 * 60 + (slotIdx + 1) * 75);
  return d;
}

/** "1:23:45" o "23:45" — il conto alla rovescia in dashboard. */
export function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

// ─── Macchine ────────────────────────────────────────────────────────────────

/**
 * Quali macchine esistono FISICAMENTE nella lavanderia di una camera.
 *
 * Unico posto in cui vive questa regola. Prima la stessa condizione
 * (`num > 0 && num < 100`) era ricopiata in sei punti, ed erano già divergenti:
 * in uno l'elenco delle asciugatrici della Manica era vuoto.
 *
 * Camere 1–99 → Manica: una lavatrice e un'asciugatrice.
 * Dal 100 in su → Valentino: tre e tre.
 */
export function machinesFor(roomNumber: string | null | undefined): { washers: string[]; dryers: string[] } {
  const num = parseInt(roomNumber?.match(/^(\d+)/)?.[1] || "0", 10);
  const manica = num > 0 && num < 100;
  return manica
    ? { washers: ["W-A"], dryers: ["D-A"] }
    : { washers: ["W-A", "W-B", "W-C"], dryers: ["D-A", "D-B", "D-C"] };
}

/** Chi ha prenotato una certa macchina in un certo turno, se qualcuno. */
export function bookingAt(week: WeekData, day: number, slot: number, wid: string): string | undefined {
  if (day < 0 || slot < 0) return undefined;
  const v = week?.[day]?.[slot]?.[wid];
  return v ? String(v) : undefined;
}

/** Il turno precedente, scavalcando all'indietro il cambio di giorno. */
export function prevRef(day: number, slot: number) {
  if (slot > 0) return { day, slot: slot - 1 };
  return { day: (day + 6) % 7, slot: N_SLOTS - 1 };
}

/**
 * Il turno DOPO, con lo stesso avvolgimento di prevRef.
 *
 * Serve a dire a chi prenota una lavatrice quale turno di asciugatrice gli
 * tocca di conseguenza: l'ultimo turno del giorno passa il testimone al primo
 * del giorno seguente, esattamente come prevRef guarda indietro.
 */
export function nextRef(day: number, slot: number) {
  if (slot < N_SLOTS - 1) return { day, slot: slot + 1 };
  return { day: (day + 1) % 7, slot: 0 };
}

/**
 * Lo stato delle macchine in un dato turno, come lo vede la dashboard.
 *
 * L'asciugatrice non si prenota: è implicitamente di chi ha la lavatrice con la
 * stessa lettera nel turno PRECEDENTE. Ecco perché qui si guarda indietro di
 * uno (`p`) per le asciugatrici e di due (`pp`) per sapere chi c'era prima.
 */
export function deriveMachines(
  week: WeekData, status: StatusData, day: number, slot: number, roomNumber: string | null,
): Machine[] {
  const p  = prevRef(day, slot);
  const pp = prevRef(p.day, p.slot);
  const mk = (id: string, type: MachineType, room?: string, prevRoom?: string): Machine => {
    const st: MachineStatus = status[id] === "oos" ? "out-of-order" : room ? "in-use" : "available";
    return { id, label: id[2], type, status: st, room, prevRoom };
  };
  const out: Machine[] = [];
  const { washers, dryers } = machinesFor(roomNumber);

  for (const L of washers.map((id) => id.slice(2))) {
    const wid = "W-" + L;
    out.push(mk(wid, "washer", bookingAt(week, day, slot, wid), bookingAt(week, p.day, p.slot, wid)));
  }
  for (const L of dryers.map((id) => id.slice(2))) {
    const did = "D-" + L, wid = "W-" + L;
    out.push(mk(did, "dryer", bookingAt(week, p.day, p.slot, wid), bookingAt(week, pp.day, pp.slot, wid)));
  }
  return out;
}

// ─── Le prenotazioni della propria camera ────────────────────────────────────

export function myWeekBookings(week: WeekData, room: string): MyBooking[] {
  const out: MyBooking[] = [];
  if (!room) return out;
  for (let day = 0; day < 7; day++) {
    const dd = week[day]; if (!dd) continue;
    for (const slotStr of Object.keys(dd)) {
      const slot = Number(slotStr);
      const slotData = dd[slot]; if (!slotData) continue;
      for (const mid of Object.keys(slotData)) {
        // Solo le lavatrici: l'asciugatrice viene con la lavatrice e
        // contarla separatamente raddoppierebbe ogni prenotazione.
        if (mid.startsWith("W-") && slotData[mid] === room) out.push({ day, slot, mid });
      }
    }
  }
  out.sort((a, b) => a.day - b.day || a.slot - b.slot);
  return out;
}

export const isPastBooking    = (b: MyBooking) => b.day < TODAY_DOW || (b.day === TODAY_DOW && b.slot < CUR_SLOT);
export const isCurrentBooking = (b: MyBooking) => b.day === TODAY_DOW && b.slot === CUR_SLOT;

// ─── Preferiti ───────────────────────────────────────────────────────────────
//
// Per camera, non globali: cambiando stanza non restano quelli di prima.

export const favsKey = (room: string | null) => `laundryhub.favs.${room ?? "_"}`;

export function loadFavs(room: string | null): Fav[] {
  if (!room) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(favsKey(room)) || "[]");
    return Array.isArray(raw)
      ? raw.filter((x: any) => x && typeof x.day === "number" && typeof x.slot === "number")
      : [];
  } catch { return []; }
}
