// roomsApi.ts — backend per le sale a FASCE LIBERE (Cinema e Musica).
//
// Modello dati: a differenza della lavanderia (turni fissi da 75'), qui ogni
// prenotazione è un blocco di tempo arbitrario su un giorno della settimana:
//   { id, day(0=Lun..6=Dom), start, end, name, type? }
// dove start/end sono MINUTI dalla mezzanotte (es. 14:30 = 870), e possono
// superare 1440 quando la fascia scavalca la mezzanotte. Si guarda sempre e
// solo la settimana corrente: le vecchie le pota `prune_old_weeks` nel
// database, non c'è più un job che cancella tutto il lunedì notte.

export type RoomKind = "cinema" | "music";
export type CinemaType = "private" | "open";

export interface RoomBooking {
  id: string;
  day: number;        // 0 = Lunedì … 6 = Domenica
  start: number;      // minuti da mezzanotte
  end: number;        // minuti da mezzanotte (> start)
  name: string;
  type?: CinemaType;  // solo Cinema
  /**
   * Le due metà di una prenotazione che scavalca la mezzanotte condividono
   * questo identificativo: giovedì 21:00–24:00 e venerdì 00:00–01:00 sono la
   * stessa serata, salvate su due giorni perché è così che il vincolo
   * anti-sovrapposizione riesce a vederle entrambe. Assente per tutte le altre.
   *
   * Della notte fra domenica e lunedì qui ne arriva UNA sola metà, e non è un
   * errore: la coda sta sul lunedì della settimana dopo, che questa lista non
   * comprende. Ricompare da sé quando la settimana gira — cioè quando quelle
   * ore arrivano davvero. Vedi migrations/018.
   */
  group?: string;
}

const TOKEN = import.meta.env.VITE_SECRET_TOKEN;

// Le due sale erano lo STESSO Code.gs deployato due volte, su due spreadsheet
// distinti. Qui sono un endpoint solo: la sala arriva come ?space=.
//
// Insieme al percorso Apps Script se n'e' andato anche lo store finto che
// serviva quando gli URL erano ancora dei segnaposto: non c'e' piu' un caso in
// cui l'app giri senza backend, e teneva in vita `isMock` — un secondo
// comportamento possibile per ogni funzione di questo file.

/** URL + query comuni a ogni chiamata, con l'eventuale azione. */
function url(room: RoomKind, action?: string): string {
  return `/api/rooms?token=${TOKEN}&space=${room}` + (action ? `&action=${action}` : "");
}

const overlaps = (list: RoomBooking[], b: { day: number; start: number; end: number }) =>
  list.some((x) => x.day === b.day && b.start < x.end && x.start < b.end);

// ─── API ─────────────────────────────────────────────────────────────────────

export async function getRoomBookings(room: RoomKind): Promise<RoomBooking[]> {
  const res = await fetch(url(room));
  if (!res.ok) throw new Error("network");
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "error");
  return (data.bookings || []) as RoomBooking[];
}

export async function bookRoom(room: RoomKind, b: Omit<RoomBooking, "id">): Promise<RoomBooking[]> {
  const res = await fetch(url(room, "book"), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(b),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "error");
  return (data.bookings || []) as RoomBooking[];
}

export async function clearRoomBooking(room: RoomKind, id: string): Promise<RoomBooking[]> {
  const res = await fetch(url(room, "clear"), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "error");
  return (data.bookings || []) as RoomBooking[];
}

// Controllo sovrapposizioni riutilizzabile dalla UI (feedback immediato)
export function hasOverlap(list: RoomBooking[], day: number, start: number, end: number) {
  return overlaps(list, { day, start, end });
}
