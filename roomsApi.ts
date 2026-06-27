// roomsApi.ts — backend per le sale a FASCE LIBERE (Cinema e Musica).
//
// Modello dati: a differenza della lavanderia (turni fissi da 75'), qui ogni
// prenotazione è un blocco di tempo arbitrario su un giorno della settimana:
//   { id, day(0=Lun..6=Dom), start, end, name, type? }
// dove start/end sono MINUTI dalla mezzanotte (es. 14:30 = 870). Le prenotazioni
// si resettano ogni lunedì notte (gestione lato Apps Script), quindi lo stato è
// una semplice "settimana corrente" come per la lavanderia.
//
// Finché gli endpoint reali non sono configurati (URL "PLACEHOLDER_…"), si usa
// uno store mock in memoria così la UI è pienamente funzionante in anteprima.

export type RoomKind = "cinema" | "music";
export type CinemaType = "private" | "open";

export interface RoomBooking {
  id: string;
  day: number;        // 0 = Lunedì … 6 = Domenica
  start: number;      // minuti da mezzanotte
  end: number;        // minuti da mezzanotte (> start)
  name: string;
  type?: CinemaType;  // solo Cinema
}

// URL /exec delle Web App Apps Script (una per sala).
const ENDPOINTS: Record<RoomKind, { url: string; token: string }> = {
  cinema: { url: "https://script.google.com/macros/s/AKfycbzH5MyubyGhohwmEhP-S9NOV7-8dMGjAwo2SvAy0txuQSllJ1TK8wI5pNiSPgDX7B6c9w/exec", token: "filipposiano" },
  music:  { url: "https://script.google.com/macros/s/AKfycbxGUwtiJOCQ0Tt9wxwjVfWBSbcb2jyGyPJUewbBdqA8FQRm0sANXoEWEHeq0Rl-6EoBBg/exec",  token: "filipposiano" },
};

const isPlaceholder = (u: string) => u.startsWith("PLACEHOLDER");
export const isMock = (room: RoomKind) => isPlaceholder(ENDPOINTS[room].url);

// ─── Store MOCK (in memoria) ────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const mockStore: Record<RoomKind, RoomBooking[]> = {
  cinema: [
    { id: uid(), day: 5, start: 21 * 60,      end: 23 * 60,      name: "Mario",  type: "open" },
    { id: uid(), day: 2, start: 18 * 60 + 30, end: 20 * 60,      name: "Giulia", type: "private" },
  ],
  music: [
    { id: uid(), day: 5, start: 16 * 60,      end: 18 * 60,      name: "Band 3B" },
    { id: uid(), day: 0, start: 10 * 60,      end: 11 * 60 + 30, name: "Luca" },
  ],
};

const overlaps = (list: RoomBooking[], b: { day: number; start: number; end: number }) =>
  list.some((x) => x.day === b.day && b.start < x.end && x.start < b.end);

// ─── API ─────────────────────────────────────────────────────────────────────

export async function getRoomBookings(room: RoomKind): Promise<RoomBooking[]> {
  const ep = ENDPOINTS[room];
  if (isPlaceholder(ep.url)) return JSON.parse(JSON.stringify(mockStore[room]));
  const res = await fetch(`${ep.url}?token=${ep.token}`);
  if (!res.ok) throw new Error("network");
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "error");
  return (data.bookings || []) as RoomBooking[];
}

export async function bookRoom(room: RoomKind, b: Omit<RoomBooking, "id">): Promise<RoomBooking[]> {
  const ep = ENDPOINTS[room];
  if (isPlaceholder(ep.url)) {
    if (overlaps(mockStore[room], b)) throw new Error("overlap");
    mockStore[room] = [...mockStore[room], { ...b, id: uid() }];
    return JSON.parse(JSON.stringify(mockStore[room]));
  }
  const res = await fetch(`${ep.url}?token=${ep.token}&action=book`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(b),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "error");
  return (data.bookings || []) as RoomBooking[];
}

export async function clearRoomBooking(room: RoomKind, id: string): Promise<RoomBooking[]> {
  const ep = ENDPOINTS[room];
  if (isPlaceholder(ep.url)) {
    mockStore[room] = mockStore[room].filter((x) => x.id !== id);
    return JSON.parse(JSON.stringify(mockStore[room]));
  }
  const res = await fetch(`${ep.url}?token=${ep.token}&action=clear`, {
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
