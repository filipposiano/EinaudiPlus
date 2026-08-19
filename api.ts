// api.ts — client per la lavanderia.
//
// Punta al nuovo backend su /api/laundry (Postgres). L'interruttore
// VITE_API_BASE="legacy" fa tornare tutto agli Apps Script: e' il meccanismo di
// rollback del cutover, si cambia una variabile d'ambiente su Vercel senza
// toccare il codice.
//
// Le firme delle funzioni sono invariate apposta: LaundryView non cambia.

const TOKEN = import.meta.env.VITE_SECRET_TOKEN;

export type WeekData = Record<string, Record<string, Record<string, string>>>;
export type StatusData = Record<string, string>;

// ─── Rollback ────────────────────────────────────────────────────────────────
// I due vecchi endpoint Apps Script restano raggiungibili finche' la finestra di
// osservazione non e' chiusa. Non cancellarli prima.
const LEGACY = import.meta.env.VITE_API_BASE === "legacy";

const LEGACY_URL = "https://script.google.com/macros/s/AKfycbwDIvaEQB0hbrrXpXVwA94BqkmfBRQQy1ECTP9hvVxwrsXwE9D0opaZFOzBDsN1jgJoMw/exec";
const LEGACY_URL_NEW = "https://script.google.com/macros/s/AKfycbxErpUn1wYL0af9wtAgqdGYLr-zL8aKvs5BsIoKWu85YIuwfPHc4sKFnVAehN1F8Les9Q/exec";

/** La camera dichiarata su questo dispositivo. */
function currentRoom(): string {
  try {
    return localStorage.getItem("laundryhub.room") || "";
  } catch {
    return "";
  }
}

/**
 * L'endpoint da usare.
 *
 * In modalita' nuova e' sempre lo stesso: quale delle due lavanderie sia lo
 * decide il server con laundry_for_room(). Prima invece lo sceglieva il client
 * leggendo localStorage a ogni chiamata, quindi cambiando camera senza
 * ricaricare si poteva leggere una lavanderia e scrivere sull'altra.
 */
function endpoint(): string {
  if (!LEGACY) return "/api/laundry";
  const match = currentRoom().match(/^(\d+)/);
  const num = match ? parseInt(match[1], 10) : 0;
  return num > 0 && num < 100 ? LEGACY_URL_NEW : LEGACY_URL;
}

// Il corpo va come text/plain: serviva a evitare il preflight CORS di Apps
// Script. Con /api non servirebbe piu', ma lo teniamo perche' in modalita'
// legacy serve ancora, e cosi' c'e' un solo percorso da mantenere.
async function postAction(action: string, payload: Record<string, unknown>) {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: TOKEN, action, ...payload }),
  });

  const data = await res.json();
  if (!data.ok) {
    const err = new Error(data.error || "Errore durante l'operazione") as Error & { by?: string };
    // Il chiamante puo' leggere `by` per dire CHI ha occupato lo slot.
    err.by = data.by;
    throw err;
  }
  return data;
}

export async function getSnapshot(): Promise<{ week: WeekData; status: StatusData }> {
  const qs = LEGACY
    ? `?token=${TOKEN}`
    : `?token=${TOKEN}&room=${encodeURIComponent(currentRoom())}`;

  const res = await fetch(`${endpoint()}${qs}`);
  if (!res.ok) throw new Error("Errore di rete durante il caricamento");

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Errore restituito dal server.");

  return { week: data.week || {}, status: data.status || {} };
}

export async function book(day: number, slot: number, machine: string, room: string) {
  return postAction("book", { day, slot, machine, room });
}

// La camera va inclusa: serve al server per sapere di quale lavanderia si parla.
// Prima non veniva mandata perche' la lavanderia era implicita nell'URL.
export async function clearBooking(day: number, slot: number, machine: string) {
  return postAction("clear", { day, slot, machine, room: currentRoom() });
}

/**
 * Segnala un guasto.
 *
 * Sostituisce setStatus(): marcare una macchina fuori servizio e' passato agli
 * amministratori. Il residente che nota il guasto scrive qui, l'admin lo vede
 * nella sua lista e decide se metterla fuori servizio.
 *
 * Il canale di segnalazione resta aperto apposta: e' cosi' che i guasti si
 * scoprono davvero, di solito la sera tardi da chi sta facendo il bucato.
 */
export async function reportBroken(machine: string, note?: string) {
  const label = machine.toUpperCase().startsWith("D") ? "Asciugatrice" : "Lavatrice";
  const text =
    `[GUASTO ${machine}] ${label} ${machine.slice(-1)} segnalata non funzionante` +
    (note ? ` — ${note}` : "");
  return postAction("feedback", { room: currentRoom(), text });
}

export async function subscribePush(room: string, sub: PushSubscriptionJSON) {
  return postAction("subscribe", { room, sub });
}

export async function unsubscribePush(endpointUrl: string) {
  return postAction("unsubscribe", { endpoint: endpointUrl });
}

export async function sendFeedback(room: string | null, text: string) {
  return postAction("feedback", { room: room || "", text });
}

/**
 * Codice usa-e-getta da incollare al bot Telegram per collegare la chat a
 * questa camera. Serve un codice perché senza, chiunque potrebbe scrivere al
 * bot "sono la 112" e ricevere i promemoria di un altro.
 */
export async function telegramCode(): Promise<string> {
  const res = await postAction("telegramCode", { room: currentRoom() });
  return res.code as string;
}
