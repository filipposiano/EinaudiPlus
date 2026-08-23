// api.ts — client per la lavanderia.
//
// Parla solo con /api/laundry (Postgres). Il percorso di rollback verso i
// vecchi Apps Script è stato rimosso: la migrazione è chiusa e tenere in piedi
// due backend voleva dire tenere in piedi due comportamenti diversi, ognuno da
// spiegare a chi legge.

const TOKEN = import.meta.env.VITE_SECRET_TOKEN;

export type WeekData = Record<string, Record<string, Record<string, string>>>;
export type StatusData = Record<string, string>;

/** La camera dichiarata su questo dispositivo. */
function currentRoom(): string {
  try {
    return localStorage.getItem("laundryhub.room") || "";
  } catch {
    return "";
  }
}

// Un endpoint solo: quale delle due lavanderie sia lo decide il server con
// laundry_for_room(). Prima lo sceglieva il client leggendo localStorage a ogni
// chiamata, quindi cambiando camera senza ricaricare si poteva leggere una
// lavanderia e scrivere sull'altra.
const ENDPOINT = "/api/laundry";

// Il corpo viaggia come text/plain: era il modo di evitare il preflight CORS di
// Apps Script. Ora sarebbe superfluo, ma /api lo accetta già (readBody fa il
// parse anche da stringa) e cambiarlo romperebbe le app ancora aperte sui
// telefoni col bundle precedente. Si toglie quando non ne resta nessuna.
async function postAction(action: string, payload: Record<string, unknown>) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: TOKEN, action, ...payload }),
  });

  const data = await res.json();
  if (!data.ok) {
    const err = new Error(data.error || "Errore durante l'operazione") as Error & {
      by?: string; rifiutato?: boolean;
    };
    // Il chiamante puo' leggere `by` per dire CHI ha occupato lo slot.
    err.by = data.by;
    // Il server ha risposto, e ha detto di no. Distingue questo caso dalla rete
    // caduta, che arriva qui come TypeError di fetch: chi chiama deve poter
    // reagire in modo diverso — un rifiuto e' definitivo, una rete caduta si
    // ritenta da sola al prossimo avvio.
    err.rifiutato = true;
    throw err;
  }
  return data;
}

export async function getSnapshot(): Promise<{ week: WeekData; status: StatusData }> {
  const qs = `?token=${TOKEN}&room=${encodeURIComponent(currentRoom())}`;
  const res = await fetch(`${ENDPOINT}${qs}`);
  if (!res.ok) throw new Error("Errore di rete durante il caricamento");

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Errore restituito dal server.");

  return { week: data.week || {}, status: data.status || {} };
}

export async function book(day: number, slot: number, machine: string, room: string) {
  // `room` è l'intestatario, `actor_room` è chi sta prenotando: coincidono
  // tranne quando si prenota per qualcun altro. Il server usa la differenza per
  // impedire prenotazioni fra le due lavanderie — vedi 003-lavanderia-coerente.
  return postAction("book", { day, slot, machine, room, actor_room: currentRoom() });
}

/** Le due lavanderie sono separate: 1–99 Manica, dal 100 in su Valentino. */
export function sameLaundry(a: string, b: string): boolean {
  const n = (r: string) => { const m = r.match(/^(\d+)/); return m ? Number(m[1]) : NaN; };
  const x = n(a), y = n(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return true;   // DIREZIONE o vuoto: non si giudica
  return (x < 100) === (y < 100);
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

// ─── Modalità direzione ──────────────────────────────────────────────────────
//
// Se il dispositivo ha una sessione amministrativa valida, l'app principale
// offre qualche potere in più: prenotare a nome della DIREZIONE e cancellare
// qualunque turno. Il pannello /admin resta per le cose che qui non esistono
// (stato macchine, segnalazioni), non per duplicare queste schermate.
//
// Il controllo vero è sul cookie, lato server: qui si decide solo cosa mostrare.

export const DIREZIONE = "DIREZIONE";

/**
 * Traccia locale del fatto che su questo dispositivo si è fatto un accesso
 * amministrativo.
 *
 * NON è un'autorizzazione e non viene mai spedita: il cookie di sessione è
 * httpOnly, sta sul server ed è l'unica cosa di cui il server si fidi.
 * Scriverci `true` a mano dalla console non dà alcun potere — si otterrebbe
 * solo una chiamata di rete in più, che è esattamente ciò che questo evita.
 *
 * Serve a togliere una richiesta a ogni avvio per il 99% di chi apre l'app.
 * `adminRole()` girava sempre, e per ogni residente la risposta era "no": una
 * invocazione serverless per persona per apertura, tutti i giorni, per niente.
 */
const ADMIN_HINT = "laundryhub.adminSeen";

export function markAdminSeen(seen: boolean) {
  try {
    if (seen) localStorage.setItem(ADMIN_HINT, "1");
    else localStorage.removeItem(ADMIN_HINT);
  } catch { /* modalità privata: si torna a chiedere sempre, funziona lo stesso */ }
}

/** Il ruolo della sessione admin su questo dispositivo, se c'è. */
export async function adminRole(): Promise<string | null> {
  // Chi non ha mai fatto accesso qui non ha una sessione da verificare. Se la
  // traccia si perde (cache pulita, altro browser) non si rompe niente: si
  // rientra da 1935, e il login riscrive la traccia.
  try {
    if (localStorage.getItem(ADMIN_HINT) === null) return null;
  } catch { /* localStorage inaccessibile: si chiede al server, come prima */ }

  try {
    const res = await fetch("/api/admin/auth");
    if (!res.ok) return null;
    const data = await res.json();
    const role = data.logged ? (data.role as string) : null;
    if (!role) markAdminSeen(false);   // sessione scaduta: non richiederla a ogni avvio
    return role;
  } catch {
    return null;
  }
}

async function adminAction(action: string, payload: Record<string, unknown>) {
  const res = await fetch("/api/admin/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-requested-with": "admin" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!data.ok) {
    const err = new Error(data.error || "Errore durante l'operazione") as Error & { by?: string };
    err.by = data.by;
    throw err;
  }
  return data;
}

/** La lavanderia di una camera, come la calcola il server. 1-99 = Manica. */
function laundryIdFor(room: string): number {
  const n = parseInt(room.match(/^(\d+)/)?.[1] || "0", 10);
  return n > 0 && n < 100 ? 2 : 1;
}

export async function bookAsDirezione(day: number, slot: number, machine: string) {
  return adminAction("bookDirezione", {
    laundry_id: laundryIdFor(currentRoom()), day, slot, machine,
  });
}

/**
 * Libera un turno passando dal percorso amministrativo.
 *
 * Serve per i turni della DIREZIONE, che `clear_laundry` protegge quando la
 * chiamata arriva dal percorso pubblico. Per tutti gli altri turni il
 * risultato è identico a `clearBooking`: la permissività di sempre.
 *
 * È il server a decidere, non questa funzione — `p_as_admin` lo scrive
 * /api/admin/data dopo aver verificato il cookie. Da qui si sceglie solo quale
 * porta bussare.
 */
export async function clearAsDirezione(day: number, slot: number, machine: string) {
  return adminAction("clearDirezione", { room: currentRoom(), day, slot, machine });
}
