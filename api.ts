// api.ts — client per la lavanderia.
//
// Parla solo con /api/laundry (Postgres). Il percorso di rollback verso i
// vecchi Apps Script è stato rimosso: la migrazione è chiusa e tenere in piedi
// due backend voleva dire tenere in piedi due comportamenti diversi, ognuno da
// spiegare a chi legge.

const TOKEN = import.meta.env.VITE_SECRET_TOKEN;

export type WeekData = Record<string, Record<string, Record<string, string>>>;
export type StatusData = Record<string, string>;

/** Tema decorativo stagionale, acceso/spento dal sistemista dal pannello
 *  (vedi AdminPanel → Tema). Una sola scelta per tutta l'app, non una
 *  preferenza per residente. */
export type TemaStagionale = "nessuno" | "halloween" | "natale";

/** Il cambio biancheria della settimana corrente (martedì), impostato da FDO
 *  e sistemista (vedi AdminPanel → Cambio biancheria). `"nessuno"` quando un
 *  amministratore ha saltato di proposito quel martedì (distinto da `null`,
 *  che vuol dire "non ancora configurato affatto"). */
export type CambioBiancheria = "grande" | "piccolo" | "nessuno" | null;

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

export async function getSnapshot(): Promise<{
  week: WeekData; status: StatusData; tema: TemaStagionale; cambioBiancheria: CambioBiancheria;
  grigliataAttiva: boolean;
}> {
  const qs = `?token=${TOKEN}&room=${encodeURIComponent(currentRoom())}`;
  const res = await fetch(`${ENDPOINT}${qs}`);
  if (!res.ok) throw new Error("Errore di rete durante il caricamento");

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Errore restituito dal server.");

  return {
    week: data.week || {}, status: data.status || {}, tema: (data.tema as TemaStagionale) || "nessuno",
    // Il campo arriva già in snake_case dalla funzione SQL (stesso stile di
    // deve_cambiare_password): niente da rimappare, solo il fallback per un
    // campo assente (backend non ancora aggiornato) o non configurato.
    cambioBiancheria: (data.cambio_biancheria as CambioBiancheria) ?? null,
    // Solo il booleano: decide se la scheda Grigliata compare in
    // navigazione. Il contenuto vero lo legge getGrigliataStato() quando la
    // scheda si apre — vedi grigliata_attiva_bool() in SQL.
    grigliataAttiva: Boolean(data.grigliata_attiva),
  };
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

/** Chi ha dichiarato la bici: la camera stessa, o la reception per suo conto. */
export type BikeSource = "residente" | "sistemista";

/** Se questa camera ha dichiarato una bici, e chi l'ha fatto. */
export async function getBike(room: string): Promise<{ hasBike: boolean; creatoDa: BikeSource | null }> {
  const res = await postAction("bikeGet", { room });
  return { hasBike: Boolean(res.has_bike), creatoDa: (res.creato_da as BikeSource | undefined) ?? null };
}

/** Dichiara (o ritira la dichiarazione) che questa camera ha una bici. */
export async function setBike(room: string, hasBike: boolean): Promise<boolean> {
  const res = await postAction("bikeSet", { room, has_bike: hasBike });
  return Boolean(res.has_bike);
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
 * `adminSession()` girava sempre, e per ogni residente la risposta era "no":
 * una invocazione serverless per persona per apertura, tutti i giorni, per
 * niente.
 */
const ADMIN_HINT = "laundryhub.adminSeen";

export function markAdminSeen(seen: boolean) {
  try {
    if (seen) localStorage.setItem(ADMIN_HINT, "1");
    else localStorage.removeItem(ADMIN_HINT);
  } catch { /* modalità privata: si torna a chiedere sempre, funziona lo stesso */ }
}

/**
 * La sessione admin su questo dispositivo: il ruolo, e se il titolare deve
 * ancora scegliere una password sua.
 *
 * Il secondo dato viaggia insieme al primo perché arriva dalla stessa
 * risposta e serve nello stesso momento: chi entra con la password
 * provvisoria deve trovarsi davanti il cambio password subito, non scoprirlo
 * quando prova a fare qualcosa (vedi il gate in App.tsx).
 */
export async function adminSession(): Promise<{ role: string | null; deveCambiarePassword: boolean }> {
  const nessuna = { role: null, deveCambiarePassword: false };

  // Chi non ha mai fatto accesso qui non ha una sessione da verificare. Se la
  // traccia si perde (cache pulita, altro browser) non si rompe niente: si
  // rientra da 1935, e il login riscrive la traccia.
  try {
    if (localStorage.getItem(ADMIN_HINT) === null) return nessuna;
  } catch { /* localStorage inaccessibile: si chiede al server, come prima */ }

  try {
    const res = await fetch("/api/admin/auth");
    if (!res.ok) return nessuna;
    const data = await res.json();
    const role = data.logged ? (data.role as string) : null;
    if (!role) {
      markAdminSeen(false);   // sessione scaduta o revocata: non richiederla a ogni avvio
      return nessuna;
    }
    return { role, deveCambiarePassword: Boolean(data.deve_cambiare_password) };
  } catch {
    return nessuna;
  }
}

async function adminAction(action: string, payload: Record<string, unknown>) {
  const res = await fetch("/api/admin/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-requested-with": "admin" },
    body: JSON.stringify({ action, ...payload }),
  });
  // Stesso segnale usato da AdminPanel.tsx (vedi `call()`): un 401 qui vuol
  // dire che il cookie e' scaduto o assente. Senza questo, un tentativo di
  // prenotare o liberare un turno come DIREZIONE con la sessione scaduta
  // falliva con un errore generico, senza mai far scattare il downgrade a
  // camera vuota che App.tsx fa in risposta a "SESSIONE_SCADUTA" — chi aveva
  // la sessione appena scaduta restava con l'identita' DIREZIONE agganciata a
  // un ruolo admin ormai nullo, e ci riprovava.
  if (res.status === 401) throw new Error("SESSIONE_SCADUTA");
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

// ─── Grigliata ───────────────────────────────────────────────────────────────
//
// Percorso pubblico, endpoint a sé (/api/grigliata): stesso modello di
// fiducia di /api/laundry (camera autodichiarata), ma un dominio diverso —
// non ha senso farlo transitare dall'endpoint della lavanderia solo perché
// esiste già. Nessun vincolo di compatibilità con un client precedente,
// quindi qui il corpo viaggia come JSON vero, non il text/plain storico di
// postAction() sopra.

export type GrigliataMenu = "classico" | "vegano";

export interface GrigliataEvento {
  id: number; titolo: string; scadenza: string;
  paypalLink: string | null; satispayLink: string | null;
}

export interface GrigliataMiaAdesione {
  partecipa: boolean; menu: GrigliataMenu | null;
  pagamentoDichiarato: boolean; pagamentoConfermato: boolean;
}

export interface GrigliataStato {
  attiva: boolean; evento: GrigliataEvento | null; miaAdesione: GrigliataMiaAdesione | null;
}

const GRIGLIATA_ENDPOINT = "/api/grigliata";

async function postGrigliataAction(action: string, payload: Record<string, unknown>) {
  const res = await fetch(GRIGLIATA_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, action, room: currentRoom(), ...payload }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Errore durante l'operazione");
  return data;
}

export async function getGrigliataStato(): Promise<GrigliataStato> {
  const qs = `?token=${TOKEN}&room=${encodeURIComponent(currentRoom())}`;
  const res = await fetch(`${GRIGLIATA_ENDPOINT}${qs}`);
  if (!res.ok) throw new Error("Errore di rete durante il caricamento");

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Errore restituito dal server.");

  if (!data.attiva) return { attiva: false, evento: null, miaAdesione: null };

  return {
    attiva: true,
    evento: {
      id: data.evento.id, titolo: data.evento.titolo, scadenza: data.evento.scadenza,
      paypalLink: data.evento.paypal_link ?? null, satispayLink: data.evento.satispay_link ?? null,
    },
    miaAdesione: data.mia_adesione ? {
      partecipa: Boolean(data.mia_adesione.partecipa),
      menu: (data.mia_adesione.menu as GrigliataMenu) ?? null,
      pagamentoDichiarato: Boolean(data.mia_adesione.pagamento_dichiarato),
      pagamentoConfermato: Boolean(data.mia_adesione.pagamento_confermato),
    } : null,
  };
}

/** Aderisce o declina. `menu` è ignorato dal server se `partecipa` è falso. */
export async function grigliataIscriviti(partecipa: boolean, menu: GrigliataMenu | null) {
  return postGrigliataAction("iscrivi", { partecipa, menu });
}

export async function grigliataDichiaraPagamento() {
  return postGrigliataAction("dichiaraPagamento", {});
}
