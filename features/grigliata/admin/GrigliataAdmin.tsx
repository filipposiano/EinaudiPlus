import { useEffect, useState, type ReactNode } from "react";
import { Pencil, Plus, Check, UserPlus, WheatOff, StickyNote, X, Ticket, Search, RotateCcw, Settings, Users } from "lucide-react";
import { EMOJI_TICKET, EMOJI_TICKET_DEFAULT, suggerisciEmoji } from "../emojiTicket";
import { useAvvisiInTempoReale } from "../../../realtime";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";
import { PIANI, pianoDi, nomePiano, colorePiano } from "../../../piani";

// ─── Grigliata (delegato) ──────────────────────────────────────────────────────
//
// Riservata a delegato e sistemista (vedi
// src/modules/grigliata/domain/policy.js). Una alla volta: far partire (o
// riaprire) una grigliata chiude automaticamente quella ancora attiva — lo
// fa la funzione SQL, non questo componente.
//
// Il riepilogo (nome, stato, scadenza, statistiche) è la prima cosa che si
// vede, non il form di creazione: quello si apre dal "+" in alto a destra,
// com'era per Macchine/Bici prima che questa scheda esistesse — un'azione
// eccezionale non deve competere visivamente con "conferma pagamento", che
// è quella con cui si apre la pagina ogni giorno.

// v1.3: i menu non sono più un elenco fisso — li decide il delegato per
// ogni grigliata (tabella grigliata_menu in SQL), es. "Carne"/"Pesce". v1.3.1:
// "vegetariano"/"vegano" NON sono un menu — sono un'informazione a sé che il
// residente dichiara IN PIÙ, qualunque menu abbia scelto (vedi `dieta` su
// Adesione più sotto): si può scegliere "Carne" e dichiararsi vegani, il
// delegato prepara un piatto a parte.
// v1.5: ogni menu si scompone in una o più voci-ticket (es. menu "Carne" =
// "Salsiccia" + "Patatine" + "Bibita") — decise dal delegato insieme al menu.
// v1.8: con un'emoji facoltativa (es. 🌭), mostrata al residente accanto al nome.
type MenuTicketVoce = { id: number; nome: string; emoji?: string | null };
type MenuVoce = { id: number; nome: string; ticket: MenuTicketVoce[] };
type Dieta = "classico" | "vegetariano" | "vegano";
const NOME_DIETA: Record<Dieta, string> = { classico: "Mangia di tutto", vegetariano: "Vegetariano", vegano: "Vegano" };

// v1.1: un'adesione è, per definizione, una camera che partecipa — non
// esiste più "partecipa=false" (vedi la nota gemella in
// src/modules/grigliata/application/iscriviti.js). Il menu quindi non è
// più opzionale. v1.3: "senza glutine" e una nota libera, scritti dal
// residente — qui si leggono soltanto. v1.3.1: "dieta" torna un campo a sé
// (nel pannello non si segna 'classico', si segnano solo gli altri due).
// v1.5: i ticket di questa adesione — uno per voce del menu scelto, esistono
// solo a pagamento confermato (v1.8: tenuti allineati al menu, vedi
// grigliata_allinea_ticket in SQL); `numero` resta null finché il residente
// non usa quel ticket dal proprio schermo (Grigliata.tsx). `id` è il ticket
// di QUESTA adesione, `menu_ticket_id` la voce del menu a cui corrisponde —
// è quello da confrontare con MenuTicketVoce.id. Il delegato può solo
// rimettere "da usare" un ticket consumato (Ripristina), non usarlo.
type AdesioneTicket = {
  id: number; menu_ticket_id: number; nome: string; emoji?: string | null;
  usato: boolean; numero: number | null; usato_at: string | null;
};

type Adesione = {
  id: number; room: string; menu_id: number; dieta: Dieta;
  senza_glutine: boolean; note: string | null;
  pagamento_dichiarato: boolean; pagamento_confermato: boolean;
  confermato_da: string | null; confermato_at: string | null;
  ticket: AdesioneTicket[];
};

type Evento = {
  id: number; titolo: string; scadenza: string;
  // v1.4: il giorno VERO in cui si mangia — distinto dalla scadenza delle
  // adesioni/pagamenti, che può cadere prima.
  giorno_evento: string;
  /** v1.4 — assente se il server non ha ancora la migrazione 048: vale attivi. */
  pagamenti_attivi?: boolean;
  /** v1.4.1 — quota a persona in euro; null/assente = non indicata. */
  quota?: number | string | null;
  paypal_link: string | null; satispay_link: string | null;
  chiuso: boolean; attiva: boolean;
  /** v1.6 — assente se il server non ha ancora la migrazione 052: vale aperte
   *  finche' non e' passata `scadenza`. */
  iscrizioni_aperte?: boolean;
  /** v1.7.2 — l'ultimo numero di ticket assegnato in questo evento (unico per
   *  tutte le voci). Assente se il server non ha ancora la migrazione 056:
   *  si ricava allora dai ticket ancora presenti. */
  ticket_contatore?: number;
  menu: MenuVoce[];
};

// ─── Filtri e raggruppamento delle camere ──────────────────────────────────────
//
// v1.4: con decine di camere la griglia per piano non basta più a rispondere
// a "quante vegane?", "chi ha scritto di un'allergia?". Filtri che si
// sommano (menu E esigenza E pagamento) più una ricerca libera nelle note, e la scelta
// di raggruppare per piano (dove sono) o per menu (cosa preparare).
type FiltroEsigenza = "tutte" | "vegetariano" | "vegano" | "senza_glutine" | "note" | "nessuna";
type Raggruppa = "piano" | "menu";
// v1.8: il pannello è diviso in tre schede — come si configura l'evento,
// chi partecipa (e chi ha pagato), e il giorno vero coi ticket.
type Scheda = "impostazioni" | "partecipanti" | "giorno";
// v1.7.1: a che punto è il pagamento — "da confermare" (ha dichiarato di aver
// pagato, il delegato non ha ancora confermato) è la lista su cui lavorare.
type FiltroPagamento = "tutti" | "da_confermare" | "non_dichiarato" | "confermato";

function haPagamento(a: Adesione, f: FiltroPagamento): boolean {
  switch (f) {
    case "tutti": return true;
    case "da_confermare": return a.pagamento_dichiarato && !a.pagamento_confermato;
    case "non_dichiarato": return !a.pagamento_dichiarato && !a.pagamento_confermato;
    case "confermato": return a.pagamento_confermato;
  }
}

function haEsigenza(a: Adesione, f: FiltroEsigenza): boolean {
  switch (f) {
    case "tutte": return true;
    case "vegetariano": return a.dieta === "vegetariano";
    case "vegano": return a.dieta === "vegano";
    case "senza_glutine": return a.senza_glutine;
    case "note": return Boolean(a.note);
    case "nessuna": return a.dieta === "classico" && !a.senza_glutine && !a.note;
  }
}

/** Un interruttore con titolo e sottotitolo — fuori da GrigliataAdmin per lo
 *  stesso motivo di EditorMenu qui sotto. Stesso disegno del "senza glutine"
 *  lato residenti (features/grigliata/Grigliata.tsx). */
function Interruttore({ acceso, onClick, titolo, sottotitolo, disabilitato }: {
  acceso: boolean; onClick: () => void; titolo: string; sottotitolo?: string; disabilitato?: boolean;
}) {
  return (
    <button onClick={onClick} role="switch" aria-checked={acceso} disabled={disabilitato}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%",
        background: "none", border: "none", padding: 0, textAlign: "left", color: "var(--foreground)",
        cursor: disabilitato ? "default" : "pointer", opacity: disabilitato ? 0.6 : 1,
      }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>{titolo}</span>
        {sottotitolo && <span style={{ display: "block", fontSize: 11, ...S.sub }}>{sottotitolo}</span>}
      </span>
      <span style={{
        flexShrink: 0, display: "flex", alignItems: "center", borderRadius: 99, padding: 3,
        width: 40, height: 24, boxSizing: "border-box",
        background: acceso ? "var(--primary)" : "var(--secondary)",
        border: acceso ? "none" : "1px solid var(--border)",
        justifyContent: acceso ? "flex-end" : "flex-start",
      }}>
        <span style={{ width: 18, height: 18, borderRadius: 99, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
      </span>
    </button>
  );
}

// ─── Editor dell'elenco dei menu ──────────────────────────────────────────────
//
// Lo stesso per "fai partire" e "modifica". Una voce porta l'id solo se il
// menu esiste già: è così che la SQL distingue "rinominato" (le scelte già
// fatte restano) da "tolto e aggiunto". `chiave` serve solo a React per
// tenere il fuoco nel campo giusto mentre si aggiungono/tolgono righe.
//
// Fuori da GrigliataAdmin di proposito: un componente dichiarato DENTRO un
// altro viene ricreato a ogni render, e un <input> ricreato perde il fuoco
// a ogni lettera digitata.

// `emojiScelta`: il delegato l'ha scelta lui (o arriva dal server) — da lì
// in poi rinominare il ticket non la cambia più. Finché è false, segue il
// nome ("Salsiccia" → 🌭, vedi suggerisciEmoji).
type VoceTicketEditor = { chiave: number; id?: number; nome: string; emoji: string | null; emojiScelta: boolean };
type VoceEditor = { chiave: number; id?: number; nome: string; ticket: VoceTicketEditor[] };

const MENU_MAX = 10;
const TICKET_MAX = 10;
const MENU_DI_DEFAULT = ["Carne", "Pesce"];
let prossimaChiave = 1;

const voceTicketNuova = (nome: string, id?: number, emoji?: string | null): VoceTicketEditor =>
  id
    ? { chiave: prossimaChiave++, id, nome, emoji: emoji ?? null, emojiScelta: true }
    : { chiave: prossimaChiave++, nome, emoji: suggerisciEmoji(nome), emojiScelta: false };
// Senza un elenco esplicito di ticket, una voce nuova parte con UN ticket
// già pronto (stesso nome del menu): un menu richiede sempre almeno un
// ticket, niente form che parte già in uno stato non valido.
const voceNuova = (nome: string, id?: number, ticket?: VoceTicketEditor[]): VoceEditor =>
  ({ chiave: prossimaChiave++, id, nome, ticket: ticket ?? [voceTicketNuova(nome)] });
const vociDiDefault = () => MENU_DI_DEFAULT.map((nome) => voceNuova(nome));
/** Il formato che si aspettano grigliataCrea/grigliataModifica. */
const vociDaInviare = (voci: VoceEditor[]) =>
  voci.map((v) => ({
    ...(v.id ? { id: v.id } : {}),
    nome: v.nome,
    ticket: v.ticket.map((t) => ({ ...(t.id ? { id: t.id } : {}), nome: t.nome, emoji: t.emoji ?? "" })),
  }));

function EditorMenu({ voci, onChange, scelte, ticketScelte }: {
  voci: VoceEditor[];
  onChange: (voci: VoceEditor[]) => void;
  /** Quante camere hanno già scelto ciascun menu (per id), solo in modifica. */
  scelte?: Record<number, number>;
  /** Quante volte ciascuna voce (per id) è già stata ritirata, solo in modifica. */
  ticketScelte?: Record<number, number>;
}) {
  // La voce-ticket di cui è aperta la tavolozza delle emoji (una alla volta).
  const [emojiAperta, setEmojiAperta] = useState<number | null>(null);
  const rinomina = (chiave: number, nome: string) =>
    onChange(voci.map((v) => (v.chiave === chiave ? { ...v, nome } : v)));
  const togli = (chiave: number) => onChange(voci.filter((v) => v.chiave !== chiave));
  const cambiaTicket = (chiaveMenu: number, chiaveTicket: number, f: (t: VoceTicketEditor) => VoceTicketEditor) =>
    onChange(voci.map((v) => (v.chiave === chiaveMenu
      ? { ...v, ticket: v.ticket.map((t) => (t.chiave === chiaveTicket ? f(t) : t)) }
      : v)));
  const rinominaTicket = (chiaveMenu: number, chiaveTicket: number, nome: string) =>
    cambiaTicket(chiaveMenu, chiaveTicket, (t) => (t.emojiScelta ? { ...t, nome } : { ...t, nome, emoji: suggerisciEmoji(nome) }));
  const scegliEmoji = (chiaveMenu: number, chiaveTicket: number, emoji: string | null) =>
    cambiaTicket(chiaveMenu, chiaveTicket, (t) => ({ ...t, emoji, emojiScelta: true }));
  const toglieTicket = (chiaveMenu: number, chiaveTicket: number) =>
    onChange(voci.map((v) => (v.chiave === chiaveMenu
      ? { ...v, ticket: v.ticket.filter((t) => t.chiave !== chiaveTicket) }
      : v)));
  const aggiungiTicket = (chiaveMenu: number) =>
    onChange(voci.map((v) => (v.chiave === chiaveMenu ? { ...v, ticket: [...v.ticket, voceTicketNuova("")] } : v)));

  return (
    <div>
      <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Menu fra cui scegliere</label>
      <div style={{ display: "grid", gap: 10 }}>
        {voci.map((v) => {
          const usato = (v.id && scelte?.[v.id]) || 0;
          // Un menu già scelto da qualcuno non si toglie (lo rifiuterebbe
          // comunque la SQL): prima va spostata quella camera. L'ultimo
          // rimasto nemmeno — serve almeno un menu.
          const bloccato = usato > 0 || voci.length === 1;
          return (
            <div key={v.chiave} style={{ display: "grid", gap: 6, padding: 8, borderRadius: 10, background: "var(--secondary)" }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input style={{ ...S.input, flex: 1, minWidth: 0, background: "var(--card)" }} value={v.nome} maxLength={40}
                  onChange={(e) => rinomina(v.chiave, e.target.value)}
                  placeholder="Es. Carne" />
                <button onClick={() => togli(v.chiave)} disabled={bloccato}
                  title={usato > 0 ? `Scelto da ${usato} ${usato === 1 ? "camera" : "camere"}: non si può togliere` : "Togli questo menu"}
                  aria-label={`Togli ${v.nome || "menu"}`}
                  style={{
                    width: 30, height: 30, flexShrink: 0, borderRadius: 8, border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "none", color: "var(--muted-foreground)",
                    cursor: bloccato ? "default" : "pointer", opacity: bloccato ? 0.35 : 1,
                  }}>
                  <X size={14} />
                </button>
              </div>

              {/* Le voci-ticket di QUESTO menu — un livello annidato, stesso
                  schema (nome + togli + aggiungi), un "Ticket" invece di un
                  "Togli questo menu" quando bloccato. */}
              <div style={{ paddingLeft: 14, display: "grid", gap: 4 }}>
                <label style={{ fontSize: 11, ...S.sub }}>Ticket di questo menu</label>
                {v.ticket.map((t) => {
                  // Bloccata solo se qualcuno l'ha già RITIRATA al banco: i
                  // ticket assegnati ma non usati spariscono con la voce.
                  const usatoTicket = (t.id && ticketScelte?.[t.id]) || 0;
                  const bloccatoTicket = usatoTicket > 0 || v.ticket.length === 1;
                  const aperta = emojiAperta === t.chiave;
                  return (
                    <div key={t.chiave} style={{ display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button onClick={() => setEmojiAperta(aperta ? null : t.chiave)}
                        title="Scegli l'emoji di questo ticket" aria-label={`Emoji di ${t.nome || "questo ticket"}`} aria-expanded={aperta}
                        style={{
                          width: 34, height: 34, flexShrink: 0, borderRadius: 8, fontSize: 18, lineHeight: 1,
                          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                          background: "var(--card)", border: `1px solid ${aperta ? "var(--primary)" : "var(--border)"}`,
                          opacity: t.emoji ? 1 : 0.45,
                        }}>
                        {t.emoji || EMOJI_TICKET_DEFAULT}
                      </button>
                      <input style={{ ...S.input, flex: 1, minWidth: 0, background: "var(--card)" }} value={t.nome} maxLength={40}
                        onChange={(e) => rinominaTicket(v.chiave, t.chiave, e.target.value)}
                        placeholder="Es. Salsiccia" />
                      <button onClick={() => toglieTicket(v.chiave, t.chiave)} disabled={bloccatoTicket}
                        title={usatoTicket > 0 ? `Già ritirato ${usatoTicket} ${usatoTicket === 1 ? "volta" : "volte"}: non si può togliere` : "Togli questo ticket"}
                        aria-label={`Togli ${t.nome || "ticket"}`}
                        style={{
                          width: 26, height: 26, flexShrink: 0, borderRadius: 7, border: "1px solid var(--border)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: "none", color: "var(--muted-foreground)",
                          cursor: bloccatoTicket ? "default" : "pointer", opacity: bloccatoTicket ? 0.35 : 1,
                        }}>
                        <X size={12} />
                      </button>
                    </div>
                    {aperta && (
                      <div style={{
                        display: "flex", flexWrap: "wrap", gap: 2, padding: 6, borderRadius: 10,
                        background: "var(--card)", border: "1px solid var(--border)",
                      }}>
                        {EMOJI_TICKET.map((e) => (
                          <button key={e} onClick={() => { scegliEmoji(v.chiave, t.chiave, e); setEmojiAperta(null); }}
                            aria-label={e} aria-pressed={t.emoji === e}
                            style={{
                              width: 32, height: 32, fontSize: 18, lineHeight: 1, borderRadius: 7, cursor: "pointer",
                              border: "none", background: t.emoji === e ? "color-mix(in srgb, var(--primary) 18%, transparent)" : "none",
                            }}>
                            {e}
                          </button>
                        ))}
                        {/* Una qualsiasi, dalla tastiera del telefono. */}
                        <input aria-label="Un'altra emoji" placeholder="altra…" maxLength={16}
                          onChange={(e) => { const val = e.target.value.trim(); if (val) scegliEmoji(v.chiave, t.chiave, val); }}
                          style={{ ...S.input, width: 64, height: 32, padding: "0 6px", fontSize: 13 }} />
                        <button onClick={() => { scegliEmoji(v.chiave, t.chiave, null); setEmojiAperta(null); }}
                          style={{ fontSize: 11, fontWeight: 700, padding: "0 8px", height: 32, borderRadius: 7, cursor: "pointer",
                            border: "none", background: "none", color: "var(--gray-accessible-text)" }}>
                          Nessuna
                        </button>
                      </div>
                    )}
                    </div>
                  );
                })}
                {v.ticket.length < TICKET_MAX && (
                  <button onClick={() => aggiungiTicket(v.chiave)}
                    style={{
                      display: "flex", alignItems: "center", gap: 4, marginTop: 2, fontSize: 11, fontWeight: 700,
                      color: "var(--gray-accessible-text)", background: "none", border: "none", cursor: "pointer", padding: 0,
                    }}>
                    <Plus size={11} /> Aggiungi un ticket
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {voci.length < MENU_MAX && (
        <button onClick={() => onChange([...voci, voceNuova("")])}
          style={{
            display: "flex", alignItems: "center", gap: 4, marginTop: 8, fontSize: 12, fontWeight: 700,
            color: "var(--gray-accessible-text)", background: "none", border: "none", cursor: "pointer", padding: 0,
          }}>
          <Plus size={13} /> Aggiungi un menu
        </button>
      )}
      <p style={{ fontSize: 11, ...S.sub, marginTop: 6 }}>
        Cosa si mangia (es. "Carne"/"Pesce") — non è legato a vegetariano,
        vegano o senza glutine: quello lo dichiara il residente a parte,
        qualunque menu scelga. Il primo è preselezionato per i residenti. Le
        voci-ticket di ciascun menu (es. "Salsiccia", "Bibita") sono quello
        che il residente ritira una alla volta il giorno della grigliata —
        servono almeno una per menu.
      </p>
    </div>
  );
}

type Overview = { evento: Evento | null; adesioni: Adesione[] };

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

/** "Grigliata del 20 settembre" — il nome di comodo suggerito dalla
 *  scadenza scelta, così l'evento ha subito un nome che lo distingue
 *  dall'ultimo (e da quello prima ancora), invece del generico "Grigliata"
 *  ripetuto ogni volta. Resta un suggerimento: il campo titolo si può
 *  sempre riscrivere a mano. */
function titoloDaData(dataISO: string): string {
  const d = new Date(dataISO);
  if (Number.isNaN(d.getTime())) return "Grigliata";
  return `Grigliata del ${d.getDate()} ${MESI[d.getMonth()]}`;
}

/** Il valore di default per il campo `<input type="datetime-local">`: fra
 *  tre giorni alle 18:00 — un punto di partenza plausibile, non vincolante. */
function scadenzaDiDefault(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(18, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Come sopra, ma per precompilare l'editor della scadenza a partire da un
 *  ISO già salvato (che porta anche i secondi, che l'input non accetta). */
function isoInDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "12,50 €" — o null se la quota non è indicata. PostgREST restituisce un
 *  `numeric` come numero, ma non lo si dà per scontato. */
function fmtQuota(q: number | string | null | undefined): string | null {
  if (q == null || q === "") return null;
  const n = Number(q);
  return Number.isFinite(n) ? n.toLocaleString("it-IT", { style: "currency", currency: "EUR" }) : null;
}

/** Per precompilare il campo: "12,5" invece di "12.5". */
function quotaInCampo(q: number | string | null | undefined): string {
  return q == null || q === "" ? "" : String(Number(q)).replace(".", ",");
}

function fmtData(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "AAAA-MM-GG" di oggi nel fuso del dispositivo — stesso formato del
 *  `date` del giorno della grigliata, per un confronto diretto. */
function oggiISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Il giorno dell'evento (un `date` puro, "AAAA-MM-GG", senza orario) alla
 *  data odierna + 3 giorni — stesso orizzonte del default della scadenza. */
function giornoEventoDiDefault(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "20 settembre" da un `date` puro — split sui componenti invece di
 *  passare per `new Date(iso)`: un `date` senza orario letto come UTC e poi
 *  riformattato in fuso locale potrebbe slittare di un giorno. */
function fmtGiorno(dataIso: string): string {
  const [y, m, d] = dataIso.split("-").map(Number);
  if (!y || !m || !d) return dataIso;
  return new Date(y, m - 1, d).toLocaleDateString("it-IT", { day: "numeric", month: "long" });
}

export function GrigliataAdmin() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Modifica di titolo e scadenza dell'evento corrente — a parte dal form
  // di creazione qui sotto: qui si corregge un evento che esiste già, non
  // se ne fa partire uno nuovo.
  const [modificaEvento, setModificaEvento] = useState(false);
  const [nuovoTitolo, setNuovoTitolo] = useState("");
  const [nuovaScadenza, setNuovaScadenza] = useState("");
  const [nuovoGiornoEvento, setNuovoGiornoEvento] = useState("");
  const [menuModifica, setMenuModifica] = useState<VoceEditor[]>([]);
  const [nuovaQuota, setNuovaQuota] = useState("");

  // Aggiunta a mano di una camera — per chi non usa l'app, o per registrare
  // chi ha dato la sua parola di persona. Sempre "partecipa", con un menu:
  // e' quello che grigliata_admin_aggiungi_adesione fa (vedi il commento
  // gemello lato SQL).
  const [aggiungiCamera, setAggiungiCamera] = useState(false);
  const [nuovaCamera, setNuovaCamera] = useState("");
  // null = il menu di base (gli id si conoscono solo dopo il caricamento).
  const [nuovoMenuCamera, setNuovoMenuCamera] = useState<number | null>(null);
  const [nuovaDietaCamera, setNuovaDietaCamera] = useState<Dieta>("classico");
  const [nuovoGlutineCamera, setNuovoGlutineCamera] = useState(false);

  // "Elimina" chiede conferma DENTRO la pagina, non con window.confirm():
  // e' bloccato in diversi contesti (PWA installata, iframe senza
  // allow-modals) e in quel caso torna false senza mostrare niente — il
  // pulsante sembra semplicemente non funzionare. Stessa scelta già fatta
  // in Manutenzione.tsx per lo stesso motivo.
  const [daEliminare, setDaEliminare] = useState(false);

  // Ogni pastiglia è cliccabile, confermata o no: apre questo popup invece
  // di agire al primo tocco — confermare un incasso o togliere una camera
  // sono azioni reali (la prima avvisa la camera), meritano un passaggio in
  // più, come "Elimina" qui sopra. Il popup dice esplicitamente che si può
  // confermare anche se la camera non ha ancora toccato "Ho pagato" da sé
  // (es. ha pagato in mano, o al bancomat): non è un requisito, solo
  // un'informazione che il delegato può usare o no.
  const [adesioneSelezionata, setAdesioneSelezionata] = useState<Adesione | null>(null);

  // Form "fai partire una nuova grigliata" — chiuso di default, si apre dal
  // "+" in alto: è l'azione eccezionale, non quella di ogni giorno.
  const [mostraForm, setMostraForm] = useState(false);
  const [titolo, setTitolo] = useState(titoloDaData(scadenzaDiDefault()));
  const [titoloModificato, setTitoloModificato] = useState(false);
  const [scadenza, setScadenza] = useState(scadenzaDiDefault());
  const [giornoEvento, setGiornoEvento] = useState(giornoEventoDiDefault());
  const [paypal, setPaypal] = useState("");
  const [satispay, setSatispay] = useState("");
  const [menuNuovi, setMenuNuovi] = useState<VoceEditor[]>(vociDiDefault);
  // v1.4: raccogliere le quote dall'app è una scelta, non un obbligo.
  const [pagamentiNuovi, setPagamentiNuovi] = useState(true);
  const [quotaNuova, setQuotaNuova] = useState("");

  // Riattivare i pagamenti su un evento che non ha nessun link (creato con
  // i pagamenti spenti) chiede prima i link: si apre questo mini-form.
  const [chiediLink, setChiediLink] = useState(false);
  const [linkPaypal, setLinkPaypal] = useState("");
  const [linkSatispay, setLinkSatispay] = useState("");

  const [filtroMenu, setFiltroMenu] = useState<number | null>(null);
  const [filtroEsigenza, setFiltroEsigenza] = useState<FiltroEsigenza>("tutte");
  const [filtroPagamento, setFiltroPagamento] = useState<FiltroPagamento>("tutti");
  const [cerca, setCerca] = useState("");
  const [raggruppa, setRaggruppa] = useState<Raggruppa>("piano");
  // null = nessuna scelta ancora: vale la scheda "naturale" del momento (vedi
  // schedaAttiva più sotto).
  const [scheda, setScheda] = useState<Scheda | null>(null);
  const [tuttiUsati, setTuttiUsati] = useState(false);

  const carica = () =>
    call<Overview>("grigliataOverview")
      .then((r) => setOverview(r))
      .catch((e: any) => setMsg(e.message));

  useEffect(() => { carica(); }, []);

  // Il giorno della grigliata i ticket si usano dagli schermi dei residenti,
  // i pagamenti si dichiarano in qualunque momento. v1.9: il pannello lo sa
  // subito dagli avvisi in tempo reale (vedi realtime.ts) — il canale
  // dell'admin riceve ogni cambiamento. Un errore di rete qui non mostra
  // nessun messaggio: riprova da solo al prossimo avviso o giro.
  const ricaricaSilenziosa = () => {
    call<Overview>("grigliataOverview").then((r) => setOverview(r)).catch(() => {});
  };
  const inTempoReale = useAvvisiInTempoReale([{ topic: "grigliata:admin", jitterMs: 300, minimoMs: 1500 }], ricaricaSilenziosa);

  // Rete di sicurezza: ogni 30 secondi con gli avvisi attivi, ogni 10
  // (come prima) senza. Si ferma quando la scheda non è visibile.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) ricaricaSilenziosa();
    }, inTempoReale ? 30_000 : 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inTempoReale]);

  // Cambiando la data proposta, il titolo suggerito la segue — a meno che
  // non sia già stato scritto a mano: altrimenti bastava toccare la
  // scadenza per perdere un titolo che si era appena personalizzato.
  function cambiaScadenzaForm(v: string) {
    setScadenza(v);
    if (!titoloModificato) setTitolo(titoloDaData(v));
  }

  async function creaEvento() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataCrea", {
        titolo, scadenza: new Date(scadenza).toISOString(), giorno_evento: giornoEvento,
        paypal_link: pagamentiNuovi ? paypal : "", satispay_link: pagamentiNuovi ? satispay : "",
        menu: vociDaInviare(menuNuovi), pagamenti_attivi: pagamentiNuovi, quota: quotaNuova,
      });
      setMostraForm(false);
      setPaypal(""); setSatispay(""); setTitoloModificato(false);
      setMenuNuovi(vociDiDefault()); setPagamentiNuovi(true); setQuotaNuova("");
      setGiornoEvento(giornoEventoDiDefault());
      setFiltroMenu(null); setFiltroEsigenza("tutte"); setFiltroPagamento("tutti"); setCerca("");
      await carica();
      setMsg("Grigliata avviata.");
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function chiudi() {
    if (!overview?.evento || busy) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataChiudi", { evento_id: overview.evento.id });
      await carica();
      setMsg("Grigliata chiusa.");
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function riapri() {
    if (!overview?.evento || busy) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataRiapri", { evento_id: overview.evento.id });
      await carica();
      setMsg("Grigliata riaperta.");
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function elimina() {
    if (!overview?.evento || busy) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataElimina", { evento_id: overview.evento.id });
      setDaEliminare(false);
      await carica();
      setMsg("Grigliata eliminata.");
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  /** Accende o spegne i pagamenti. Spegnerli non tocca i flag delle
   *  adesioni: li nasconde soltanto, riaccendendo ricompaiono. */
  async function impostaPagamenti(attivi: boolean, paypalLink = "", satispayLink = "") {
    if (!overview?.evento || busy) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataPagamenti", {
        evento_id: overview.evento.id, attivi, paypal_link: paypalLink, satispay_link: satispayLink,
      });
      setChiediLink(false); setLinkPaypal(""); setLinkSatispay("");
      await carica();
      setMsg(attivi ? "Pagamenti attivati." : "Pagamenti disattivati.");
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  function toccaPagamenti() {
    const e = overview?.evento;
    if (!e) return;
    if (pagamentiAttivi) { impostaPagamenti(false); return; }
    if (e.paypal_link || e.satispay_link) { impostaPagamenti(true); return; }
    setChiediLink((v) => !v);
  }

  function apriModificaEvento() {
    if (!overview?.evento) return;
    setNuovoTitolo(overview.evento.titolo);
    setNuovaScadenza(isoInDatetimeLocal(overview.evento.scadenza));
    setNuovoGiornoEvento(overview.evento.giorno_evento);
    setMenuModifica(overview.evento.menu.map((m) =>
      voceNuova(m.nome, m.id, m.ticket.map((t) => voceTicketNuova(t.nome, t.id, t.emoji)))));
    setNuovaQuota(quotaInCampo(overview.evento.quota));
    setModificaEvento(true);
  }

  async function salvaEvento() {
    if (!overview?.evento || busy) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataModifica", {
        evento_id: overview.evento.id, titolo: nuovoTitolo, scadenza: new Date(nuovaScadenza).toISOString(),
        giorno_evento: nuovoGiornoEvento, menu: vociDaInviare(menuModifica),
      });
      // La quota ha una sua azione (vale anche su un evento chiuso, e non
      // passa dai controlli di titolo/scadenza): si manda solo se è cambiata.
      if (nuovaQuota.trim() !== quotaInCampo(overview.evento.quota)) {
        await call("grigliataQuota", { evento_id: overview.evento.id, quota: nuovaQuota });
      }
      setModificaEvento(false);
      await carica();
      setMsg("Grigliata aggiornata.");
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  /** Torna true/false: il popup che la chiama si chiude solo se è andata a
   *  buon fine, altrimenti resta aperto con l'errore già mostrato sotto. */
  async function confermaPagamento(adesioneId: number): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataConfermaPagamento", { adesione_id: adesioneId });
      await carica();
      return true;
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confermaSelezionata() {
    if (!adesioneSelezionata) return;
    if (await confermaPagamento(adesioneSelezionata.id)) setAdesioneSelezionata(null);
  }

  /** "Torna indietro" su una conferma data per errore — funziona anche se
   *  un ticket di quell'adesione è già stato usato, e li cancella tutti,
   *  usati compresi (senza conferma, niente ticket). */
  async function annullaConferma(adesioneId: number): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataAnnullaConfermaPagamento", { adesione_id: adesioneId });
      await carica();
      return true;
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function annullaConfermaSelezionata() {
    if (!adesioneSelezionata) return;
    if (await annullaConferma(adesioneSelezionata.id)) setAdesioneSelezionata(null);
  }

  /** Rimette "da usare" un ticket consumato (slider trascinato per errore).
   *  Il popup della camera resta aperto, aggiornato: si vede subito il
   *  ticket tornare "non ancora ritirato". */
  async function ripristinaTicket(ticketId: number) {
    if (busy || !adesioneSelezionata) return;
    const adesioneId = adesioneSelezionata.id;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataRipristinaTicket", { ticket_id: ticketId });
      const r = await call<Overview>("grigliataOverview");
      setOverview(r);
      setAdesioneSelezionata(r.adesioni.find((a) => a.id === adesioneId) ?? null);
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function aggiungiAdesione() {
    if (!overview?.evento || busy || menuCameraEffettivo == null) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataAggiungiAdesione", {
        evento_id: overview.evento.id, room: nuovaCamera, menu_id: menuCameraEffettivo, dieta: nuovaDietaCamera,
        senza_glutine: nuovoGlutineCamera,
      });
      setAggiungiCamera(false);
      setNuovaCamera("");
      setNuovaDietaCamera("classico");
      setNuovoGlutineCamera(false);
      await carica();
      setMsg("Camera aggiunta.");
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  /** Come confermaPagamento: torna true/false così il popup sa se chiudersi. */
  async function rimuoviAdesione(adesioneId: number): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataRimuoviAdesione", { adesione_id: adesioneId });
      await carica();
      return true;
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function rimuoviSelezionata() {
    if (!adesioneSelezionata) return;
    if (await rimuoviAdesione(adesioneSelezionata.id)) setAdesioneSelezionata(null);
  }

  // Il popup della camera mostra una copia dell'adesione: a ogni
  // aggiornamento (anche quello automatico) la si rilegge dall'overview
  // nuova, così un ticket usato mentre il popup è aperto compare subito.
  useEffect(() => {
    setAdesioneSelezionata((sel) => (sel ? overview?.adesioni.find((a) => a.id === sel.id) ?? null : sel));
  }, [overview]);

  const evento = overview?.evento ?? null;
  const pagamentiAttivi = evento?.pagamenti_attivi !== false;
  // Ogni adesione è già una camera che partecipa — non serve più filtrarle.
  const partecipanti = overview?.adesioni ?? [];

  const menuEvento = evento?.menu ?? [];
  const idMenuDefault = menuEvento[0]?.id ?? null;
  const nomeMenu = (id: number) => menuEvento.find((m) => m.id === id)?.nome ?? "?";
  /** Il nome della dieta solo se NON è "classico" (mangia di tutto) —
   *  quello è la scelta della maggioranza, non si segna. */
  const nomeDieta = (a: Adesione) => (a.dieta === "classico" ? null : NOME_DIETA[a.dieta]);
  /** Menu (sempre) + dieta (solo se diversa da "classico"), per la pastiglia. */
  const etichetta = (a: Adesione) => {
    const d = nomeDieta(a);
    return d ? `${nomeMenu(a.menu_id)} · ${d}` : nomeMenu(a.menu_id);
  };
  const menuCameraEffettivo = menuEvento.some((m) => m.id === nuovoMenuCamera) ? nuovoMenuCamera : idMenuDefault;
  // Una camera che ha già risposto: il form parte dalle sue scelte, così
  // "aggiungerla" di nuovo (per correggerla) non le cancella per sbaglio il
  // "senza glutine" che aveva dichiarato.
  const cameraGiaIscritta = partecipanti.find((a) => a.room === nuovaCamera.trim()) ?? null;
  function scriviCamera(v: string) {
    setNuovaCamera(v);
    const gia = partecipanti.find((a) => a.room === v.trim());
    if (gia) { setNuovoMenuCamera(gia.menu_id); setNuovaDietaCamera(gia.dieta); setNuovoGlutineCamera(gia.senza_glutine); }
  }

  const confermati = partecipanti.filter((a) => a.pagamento_confermato).length;
  // I ticket di tutto l'evento, e a che numero si è arrivati: il contatore
  // del server se c'è (conta anche i numeri di ticket poi cancellati o
  // ripristinati, che non si riusano), altrimenti il più alto ancora visibile.
  const tuttiTicket = partecipanti.flatMap((a) => a.ticket);
  const ticketUsati = tuttiTicket.filter((t) => t.usato).length;
  const ultimoNumero = evento?.ticket_contatore
    ?? tuttiTicket.reduce((m, t) => Math.max(m, t.numero ?? 0), 0);
  // I ticket usati, dal più recente: numero, camera, voce e ora — chi serve
  // al banco controlla che numero e camera sullo schermo del residente
  // siano proprio gli ultimi usciti.
  const usatiRecenti = partecipanti
    .flatMap((a) => a.ticket.filter((t) => t.usato).map((t) => ({ ...t, room: a.room })))
    .sort((x, y) => (y.numero ?? 0) - (x.numero ?? 0));
  // Dal giorno VERO della grigliata in poi: solo da lì si attiva la sezione
  // dei ticket (vedi più sotto), come lo slider lato residente.
  const eGiornoEvento = evento != null && evento.giorno_evento <= oggiISO();
  // Il giorno della grigliata si apre direttamente sui ticket, gli altri
  // giorni su chi partecipa — finché il delegato non sceglie lui.
  const schedaAttiva: Scheda = scheda ?? (eGiornoEvento ? "giorno" : "partecipanti");  const perMenu = (id: number) => {
    const del = partecipanti.filter((a) => a.menu_id === id);
    return { totale: del.length, pagati: del.filter((a) => a.pagamento_confermato).length };
  };
  /** Quante adesioni hanno un ticket di QUESTA voce del menu (= pagate, i
   *  ticket esistono solo a pagamento confermato) e quante l'hanno già
   *  ritirato — il numero che conta il giorno della grigliata. Il confronto
   *  è con menu_ticket_id (la voce), non con l'id del ticket dell'adesione. */
  const perTicket = (voceId: number) => {
    let pagati = 0, usati = 0;
    for (const a of partecipanti) {
      const tk = a.ticket.find((t) => t.menu_ticket_id === voceId);
      if (tk) { pagati++; if (tk.usato) usati++; }
    }
    return { pagati, usati };
  };
  const scelteDi: Record<number, number> = {};
  for (const a of partecipanti) scelteDi[a.menu_id] = (scelteDi[a.menu_id] ?? 0) + 1;
  // Quante volte ciascuna voce è già stata RITIRATA: è solo quello che
  // impedisce di toglierla dal menu (grigliata_admin_modifica in SQL).
  const ticketScelteDi: Record<number, number> = {};
  for (const a of partecipanti) for (const tk of a.ticket) {
    if (tk.usato) ticketScelteDi[tk.menu_ticket_id] = (ticketScelteDi[tk.menu_ticket_id] ?? 0) + 1;
  }
  const senzaGlutine = partecipanti.filter((a) => a.senza_glutine).length;
  // Chi ha qualcosa di cui chi cucina deve tenere conto: una dieta diversa
  // da "classico", senza glutine, o una nota. È la lista da leggere prima
  // di fare la spesa, quindi sta tutta insieme invece di dover aprire una
  // pastiglia alla volta.
  const conEsigenze = partecipanti.filter((a) => a.dieta !== "classico" || a.senza_glutine || a.note);

  // Menu filtrato che non esiste più (rimosso nel frattempo): come nessun filtro.
  const menuFiltrato = menuEvento.some((m) => m.id === filtroMenu) ? filtroMenu : null;
  const testoCercato = cerca.trim().toLowerCase();
  // Con i pagamenti spenti la riga del filtro sparisce: un filtro rimasto
  // acceso da prima non deve nascondere camere senza che si veda perché.
  const pagamentoFiltrato: FiltroPagamento = pagamentiAttivi ? filtroPagamento : "tutti";
  /** Tutti i filtri attivi; `o` ne sostituisce uno solo, per contare quante
   *  camere darebbe ciascuna pastiglia di quella riga (vedi quantiCon*). */
  const passaFiltri = (a: Adesione, o: { esigenza?: FiltroEsigenza; menu?: number | null; pagamento?: FiltroPagamento } = {}) => {
    const menu = o.menu !== undefined ? o.menu : menuFiltrato;
    return (menu == null || a.menu_id === menu)
      && haEsigenza(a, o.esigenza ?? filtroEsigenza)
      && haPagamento(a, o.pagamento ?? pagamentoFiltrato)
      && (!testoCercato || a.room.toLowerCase().includes(testoCercato) || (a.note ?? "").toLowerCase().includes(testoCercato));
  };
  const filtrati = partecipanti.filter((a) => passaFiltri(a));
  const filtriAttivi = menuFiltrato != null || filtroEsigenza !== "tutte" || pagamentoFiltrato !== "tutti" || testoCercato !== "";
  const azzeraFiltri = () => { setFiltroMenu(null); setFiltroEsigenza("tutte"); setFiltroPagamento("tutti"); setCerca(""); };
  const esigenzeFiltrate = conEsigenze.filter((a) => passaFiltri(a));

  const Statistica = ({ valore, etichetta }: { valore: string | number; etichetta: string }) => (
    <div style={{ textAlign: "center" }}>
      <p style={{ fontSize: 22, fontWeight: 800 }}>{valore}</p>
      <p style={{ fontSize: 11, ...S.sub }}>{etichetta}</p>
    </div>
  );

  // Una pastiglia per adesione — stessa famiglia grafica di CameraChip in
  // BiciTab.tsx (colore del piano, distintivo in un angolo), con una
  // differenza voluta: qui il colore stesso PORTA il significato. In
  // bianco e nero finché il pagamento non è confermato, colorata col colore
  // del piano appena lo è — un solo sguardo sulla griglia dice quanto
  // manca, senza dover leggere ogni riga. Sempre cliccabile (confermata o
  // no): il popup che apre serve anche a togliere la camera, non solo a
  // confermare un pagamento.
  const AdesioneChip = ({ a, colore }: { a: Adesione; colore: string }) => {
    // Pagamenti spenti (v1.4): nessun incasso da seguire, la pastiglia è
    // sempre a colori e senza distintivi di pagamento — i flag salvati
    // restano, solo non si mostrano.
    const confermato = pagamentiAttivi ? a.pagamento_confermato : true;
    const stile = {
      position: "relative" as const,
      display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 2,
      padding: "10px 8px", borderRadius: 12, minHeight: 56,
      background: confermato ? `color-mix(in srgb, ${colore} 12%, var(--card))` : "var(--secondary)",
      border: `1px solid ${confermato ? `color-mix(in srgb, ${colore} 32%, var(--border))` : "var(--border)"}`,
      color: "var(--foreground)",
      cursor: "pointer",
      opacity: busy ? 0.6 : 1,
    } as const;
    return (
      <button onClick={() => setAdesioneSelezionata(a)} disabled={busy} style={stile}>
        <span style={{ fontSize: 15, fontWeight: 700, fontFamily: "monospace" }}>{a.room}</span>
        {/* Il menu si vede sempre (è cosa si mangia, informazione utile a
            prescindere); la dieta si aggiunge accanto SOLO se diversa da
            "classico" — è la scelta della maggioranza, non si segna, così
            i casi diversi saltano all'occhio. */}
        <span style={{
          fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em",
          color: confermato ? colore : "var(--muted-foreground)",
          maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {etichetta(a)}
        </span>
        {/* Senza glutine e nota: due icone piccole, non altro testo — la
            pastiglia deve restare leggibile a colpo d'occhio; il dettaglio
            sta nel popup e nella lista "Esigenze alimentari" più sotto. */}
        {(a.senza_glutine || a.note) && (
          <span style={{ display: "flex", gap: 4, color: "var(--muted-foreground)" }}>
            {a.senza_glutine && <WheatOff size={11} aria-label="Senza glutine" />}
            {a.note && <StickyNote size={11} aria-label="Ha scritto una nota" />}
          </span>
        )}
        {/* Non confermato ma già dichiarato: un'informazione in più, non un
            terzo colore — resta grigia, dice solo "questa ha priorità". */}
        {pagamentiAttivi && !confermato && a.pagamento_dichiarato && (
          <span style={{ fontSize: 8, color: "var(--muted-foreground)" }}>dichiarato</span>
        )}
        {/* Quanti dei suoi ticket sono già stati ritirati al banco: lo sa
            solo chi guarda qui, non è un'azione dell'admin (il tocco è del
            residente). Solo se almeno uno lo è — altrimenti è rumore su
            ogni pastiglia confermata. */}
        {confermato && a.ticket.some((t) => t.usato) && (
          <span style={{ fontSize: 8, color: colore, display: "flex", alignItems: "center", gap: 2 }}>
            <Ticket size={9} /> {a.ticket.filter((t) => t.usato).length}/{a.ticket.length} ritirati
          </span>
        )}
        {pagamentiAttivi && confermato && (
          <span style={{
            position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: 99,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: colore, color: "#fff", border: "2px solid var(--card)",
          }}>
            <Check size={9} />
          </span>
        )}
      </button>
    );
  };

  // Un gruppo per piano — stesso ordine e stessa idea di BiciTab.tsx:
  // "Manica" (un edificio a se') prima dei piani veri e propri, che
  // salgono dal primo al quarto, poi il basso fabbricato. Solo chi
  // partecipa: chi ha detto di no non interessa a questa scheda (righe
  // arriva già filtrata da chi la chiama).
  //
  // v1.4: lo stesso gruppo serve anche a raggruppare per menu — lì il pallino
  // del titolo non c'è (un menu non ha un colore), ma ogni pastiglia tiene il
  // colore del SUO piano, così si vede comunque dove andare a cercarla.
  const colorePastiglia = (a: Adesione) => {
    const p = pianoDi(a.room);
    return p === null ? "var(--foreground)" : colorePiano(p);
  };
  const Gruppo = ({ titolo, colore, righe }: { titolo: string; colore?: string; righe: Adesione[] }) => {
    if (righe.length === 0) return null;
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
          {colore && <span style={{ width: 9, height: 9, borderRadius: 99, background: colore, flexShrink: 0 }} />}
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", ...S.sub }}>
            {titolo} · {righe.length}
          </p>
        </div>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))" }}>
          {righe.map((a) => <AdesioneChip key={a.id} a={a} colore={colore ?? colorePastiglia(a)} />)}
        </div>
      </div>
    );
  };

  const fuoriSchema = filtrati.filter((a) => pianoDi(a.room) === null);

  // Una pastiglia-filtro: stessa forma per menu, esigenze e raggruppamento.
  // Il numero accanto dice quante camere resterebbero scegliendola (dati gli
  // altri filtri già attivi), così un filtro "vuoto" si vede prima di toccarlo.
  const Filtro = ({ attivo, onClick, children, n }: { attivo: boolean; onClick: () => void; children: ReactNode; n?: number }) => (
    <button onClick={onClick} aria-pressed={attivo}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
        padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: "pointer",
        border: `1px solid ${attivo ? "var(--primary)" : "var(--border)"}`,
        background: attivo ? "color-mix(in srgb, var(--primary) 14%, transparent)" : "transparent",
        color: attivo ? "var(--primary)" : "var(--foreground)",
        opacity: n === 0 && !attivo ? 0.5 : 1,
      }}>
      {children}
      {n !== undefined && <span style={{ fontSize: 11, opacity: 0.7 }}>{n}</span>}
    </button>
  );
  const quantiConEsigenza = (f: FiltroEsigenza) => partecipanti.filter((a) => passaFiltri(a, { esigenza: f })).length;
  const quantiConMenu = (id: number | null) => partecipanti.filter((a) => passaFiltri(a, { menu: id })).length;
  const quantiConPagamento = (f: FiltroPagamento) => partecipanti.filter((a) => passaFiltri(a, { pagamento: f })).length;

  return (
    <>
      {/* Titolo a sinistra, "+" a destra: su desktop questa scheda non ha
          una topbar sopra di sé (a differenza del layout mobile, che il
          nome della sezione lo mostra già lì) — un pulsante da solo,
          allineato tutto a destra, lasciava uno spazio vuoto grande quanto
          la larghezza della pagina. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>Grigliata</h2>
        <button onClick={() => { setMostraForm(true); setScheda("impostazioni"); }} title="Fai partire una nuova grigliata"
          style={{
            width: 34, height: 34, borderRadius: 99, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--primary)", color: "var(--primary-foreground)",
            border: "none", cursor: "pointer",
          }}>
          <Plus size={18} />
        </button>
      </div>

      {msg && <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      {/* ── Le tre schede ──────────────────────────────────────────────── */}
      {evento && (
        <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, borderRadius: 14, background: "var(--secondary)", marginBottom: 16 }}>
          {([
            ["giorno", "Ticket", Ticket],
            ["partecipanti", "Partecipanti", Users],
            ["impostazioni", "Impostazioni", Settings],
          ] as [Scheda, string, typeof Settings][]).map(([id, label, Icona]) => {
            const attiva = schedaAttiva === id;
            return (
              <button key={id} role="tab" aria-selected={attiva} onClick={() => setScheda(id)}
                style={{
                  flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  padding: "8px 6px", borderRadius: 10, border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: 700, lineHeight: 1.2, textAlign: "center",
                  background: attiva ? "var(--card)" : "none",
                  color: attiva ? "var(--foreground)" : "var(--muted-foreground)",
                  boxShadow: attiva ? "0 1px 3px rgba(0,0,0,.12)" : "none",
                }}>
                <Icona size={14} style={{ flexShrink: 0, color: attiva ? "var(--primary)" : undefined }} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Fai partire una nuova grigliata (dal "+" qui sopra) ──────────── */}
      {mostraForm && (!evento || schedaAttiva === "impostazioni") && (
        <div style={{ ...S.card, padding: 14, marginBottom: 16, display: "grid", gap: 12 }}>
          {evento && !evento.chiuso && (
            <p style={{ fontSize: 12, color: "var(--destructive-text)" }}>
              C'è già una grigliata attiva: farne partire una nuova la chiude subito
              (le adesioni raccolte finora restano nello storico, ma la scheda
              residenti passa a quella nuova).
            </p>
          )}

          <div>
            <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Titolo</label>
            <input style={S.input} value={titolo}
              onChange={(e) => { setTitolo(e.target.value); setTitoloModificato(true); }}
              placeholder="Grigliata" />
          </div>

          <div>
            <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Fine delle iscrizioni</label>
            <input style={S.input} type="datetime-local" value={scadenza} onChange={(e) => cambiaScadenzaForm(e.target.value)} />
            <p style={{ fontSize: 11, ...S.sub, marginTop: 4 }}>
              Dopo questa data non ci si può più iscrivere. Può anche essere già passata.
            </p>
          </div>

          <div>
            <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Giorno della grigliata</label>
            <input style={S.input} type="date" value={giornoEvento} onChange={(e) => setGiornoEvento(e.target.value)} />
            <p style={{ fontSize: 11, ...S.sub, marginTop: 4 }}>
              Il giorno vero in cui si mangia — può cadere dopo la fine delle iscrizioni.
              Dal giorno stesso, sulla scheda dei residenti, la conferma del pagamento lascia
              il posto al ticket da usare. La scheda resta visibile fino al giorno dopo la grigliata.
            </p>
          </div>

          <EditorMenu voci={menuNuovi} onChange={setMenuNuovi} />

          <div>
            <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Quota a persona (€, facoltativa)</label>
            <input style={S.input} value={quotaNuova} onChange={(e) => setQuotaNuova(e.target.value)}
              inputMode="decimal" placeholder="Es. 10 oppure 12,50" />
            <p style={{ fontSize: 11, ...S.sub, marginTop: 4 }}>
              I residenti la vedono nella scheda, anche con i pagamenti disattivati.
            </p>
          </div>

          <Interruttore acceso={pagamentiNuovi} onClick={() => setPagamentiNuovi((v) => !v)}
            titolo="Raccogli le quote dall'app"
            sottotitolo={pagamentiNuovi
              ? "I residenti vedono i link e il pulsante \"Ho pagato\"."
              : "Nessun pagamento nell'app (es. grigliata offerta, o contanti sul posto). Si può attivare dopo."} />

          {pagamentiNuovi && (
            <>
              <div>
                <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Link PayPal</label>
                <input style={S.input} value={paypal} onChange={(e) => setPaypal(e.target.value)} placeholder="paypal.me/..." />
              </div>

              <div>
                <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Link Satispay</label>
                <input style={S.input} value={satispay} onChange={(e) => setSatispay(e.target.value)} placeholder="satispay.com/..." />
              </div>
              <p style={{ fontSize: 11, ...S.sub, marginTop: -6 }}>
                Serve almeno uno dei due link. "https://" davanti non è necessario, si aggiunge da solo.
              </p>
            </>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={creaEvento} disabled={busy} style={{ ...S.btn, opacity: busy ? 0.5 : 1 }}>
              {busy ? "Avvio…" : "Avvia"}
            </button>
            <button onClick={() => setMostraForm(false)} style={S.btn}>Annulla</button>
          </div>
        </div>
      )}

      {/* ── Impostazioni: titolo, stato, date, quota, menu, pagamenti ────── */}
      {evento ? (schedaAttiva === "impostazioni" && (
        <div style={{ ...S.card, padding: 16, marginBottom: 16 }}>
          {modificaEvento ? (
            <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
              <input style={S.input} value={nuovoTitolo} onChange={(e) => setNuovoTitolo(e.target.value)} placeholder="Grigliata" />
              <input style={S.input} type="datetime-local"
                value={nuovaScadenza} onChange={(e) => setNuovaScadenza(e.target.value)} />
              <div>
                <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Giorno della grigliata</label>
                <input style={S.input} type="date" value={nuovoGiornoEvento} onChange={(e) => setNuovoGiornoEvento(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Quota a persona (€, vuota = nessuna)</label>
                <input style={S.input} value={nuovaQuota} onChange={(e) => setNuovaQuota(e.target.value)}
                  inputMode="decimal" placeholder="Es. 10 oppure 12,50" />
              </div>
              <div style={{ marginTop: 4 }}>
                <EditorMenu voci={menuModifica} onChange={setMenuModifica} scelte={scelteDi} ticketScelte={ticketScelteDi} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button onClick={salvaEvento} disabled={busy} style={{ ...S.btn, opacity: busy ? 0.5 : 1 }}>Salva</button>
                <button onClick={() => setModificaEvento(false)} style={S.btn}>Annulla</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
                <button onClick={apriModificaEvento}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 16, fontWeight: 700, color: "var(--foreground)", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
                  {evento.titolo} <Pencil size={13} style={{ flexShrink: 0, color: "var(--gray-accessible-text)" }} />
                </button>
                {/* ATTIVA/CHIUSA non è solo un'etichetta: è il pulsante che
                    attiva o disattiva la grigliata — un tocco solo, invece
                    di un "Chiudi ora"/"Riapri" separato da cercare più giù. */}
                <button onClick={() => (evento.chiuso ? riapri() : chiudi())} disabled={busy}
                  title={evento.chiuso ? "Tocca per riattivarla" : "Tocca per chiuderla subito"}
                  style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, flexShrink: 0,
                    border: "none", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
                    background: evento.attiva ? "color-mix(in srgb, #22c55e 18%, transparent)" : "var(--secondary)",
                    color: evento.attiva ? "#16a34a" : "var(--muted-foreground)",
                  }}>
                  {evento.attiva ? "ATTIVA" : "CHIUSA"}
                </button>
              </div>
              <p style={{ fontSize: 12, ...S.sub, marginBottom: 14 }}>
                {evento.iscrizioni_aperte === false || new Date(evento.scadenza).getTime() <= Date.now()
                  ? `Iscrizioni chiuse dal ${fmtData(evento.scadenza)}`
                  : `Iscrizioni fino al ${fmtData(evento.scadenza)}`}
                {" · "}Si mangia il {fmtGiorno(evento.giorno_evento)}
                {" · "}
                {fmtQuota(evento.quota) ? `Quota ${fmtQuota(evento.quota)} a persona` : "Nessuna quota indicata"}
              </p>
            </>
          )}

          {/* v1.4: i pagamenti si accendono e spengono qui, in qualunque
              momento. Spegnerli nasconde soltanto lo stato dei pagamenti,
              non lo cancella. */}
          <div style={{ paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <Interruttore acceso={pagamentiAttivi} onClick={toccaPagamenti} disabilitato={busy}
              titolo="Pagamenti nell'app"
              sottotitolo={pagamentiAttivi
                ? [evento.paypal_link && "PayPal", evento.satispay_link && "Satispay"].filter(Boolean).join(" · ") || "Attivi"
                : "Disattivati: i residenti non vedono la sezione di pagamento"} />
            {chiediLink && !pagamentiAttivi && (
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <p style={{ fontSize: 12, ...S.sub }}>Per attivarli serve almeno un link:</p>
                <input style={S.input} value={linkPaypal} onChange={(e) => setLinkPaypal(e.target.value)} placeholder="paypal.me/..." />
                <input style={S.input} value={linkSatispay} onChange={(e) => setLinkSatispay(e.target.value)} placeholder="satispay.com/..." />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => impostaPagamenti(true, linkPaypal, linkSatispay)}
                    disabled={busy || (!linkPaypal.trim() && !linkSatispay.trim())}
                    style={{ ...S.btn, opacity: busy || (!linkPaypal.trim() && !linkSatispay.trim()) ? 0.5 : 1 }}>
                    Attiva
                  </button>
                  <button onClick={() => setChiediLink(false)} style={S.btn}>Annulla</button>
                </div>
              </div>
            )}
          </div>

          {!modificaEvento && (
            <div style={{ paddingTop: 12, marginTop: 12, borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <p style={{ fontSize: 13, fontWeight: 700 }}>Menu e ticket</p>
                <button onClick={apriModificaEvento}
                  style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--gray-accessible-text)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  <Pencil size={12} /> Modifica
                </button>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {menuEvento.map((m) => (
                  <div key={m.id}>
                    <p style={{ fontSize: 13, fontWeight: 600 }}>{m.nome}</p>
                    <p style={{ fontSize: 12, ...S.sub }}>
                      {m.ticket.map((tk) => `${tk.emoji || EMOJI_TICKET_DEFAULT} ${tk.nome}`).join("  ·  ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {evento.chiuso && (
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={() => setDaEliminare(true)} disabled={busy} style={{ ...S.danger, opacity: busy ? 0.5 : 1 }}>
                Elimina
              </button>
            </div>
          )}
        </div>
      )) : (
        <div style={{ ...S.card, padding: 16, marginBottom: 16, fontSize: 13, ...S.sub, textAlign: "center" }}>
          Non c'è ancora nessuna grigliata. Falla partire dal "+" qui sopra.
        </div>
      )}

      {/* ── Giorno della grigliata: i ticket ──────────────────────────────
          Una sezione a sé, che si attiva dal giorno della grigliata (prima
          i ticket esistono ma non si possono usare, non c'è niente da
          seguire): in grande l'ultimo numero uscito — chi serve al banco lo
          confronta con lo schermo del residente, il ticket appena usato deve
          avere il successivo — e per ogni voce di ogni menu quante ne sono
          già state ritirate su quante pagate. Si aggiorna da sola (vedi il
          ricontrollo periodico più sopra). */}
      {evento && schedaAttiva === "giorno" && (
        !eGiornoEvento ? (
          <div style={{ ...S.card, padding: 16, marginBottom: 16, fontSize: 13, ...S.sub, textAlign: "center" }}>
            <Ticket size={22} style={{ display: "block", margin: "0 auto 8px", color: "var(--muted-foreground)" }} />
            Questa scheda si attiva il giorno della grigliata ({fmtGiorno(evento.giorno_evento)}): da lì segui qui i ticket
            ritirati e il numero a cui si è arrivati.
          </div>
        ) : tuttiTicket.length === 0 ? (
          <div style={{ ...S.card, padding: 16, marginBottom: 16, fontSize: 13, ...S.sub, textAlign: "center" }}>
            Ancora nessun ticket: compaiono per ogni camera appena ne confermi il pagamento.
          </div>
        ) : (
          <div style={{ ...S.card, padding: 14, marginBottom: 16, border: "1px solid color-mix(in srgb, var(--primary) 35%, var(--border))" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 14, marginBottom: 14,
              background: "color-mix(in srgb, var(--primary) 12%, transparent)",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 700 }}>Ultimo numero uscito</p>
                {usatiRecenti[0] ? (
                  <p style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
                    Camera {usatiRecenti[0].room}
                    <span style={{ fontSize: 12, fontWeight: 600, ...S.sub }}>
                      {" · "}{usatiRecenti[0].emoji || EMOJI_TICKET_DEFAULT} {usatiRecenti[0].nome}
                    </span>
                  </p>
                ) : null}
                <p style={{ fontSize: 12, ...S.sub }}>{ticketUsati} ticket usati su {tuttiTicket.length}</p>
              </div>
              <p style={{ fontSize: 48, fontWeight: 900, lineHeight: 1, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>
                {usatiRecenti[0]?.numero ?? (ultimoNumero > 0 ? ultimoNumero : "—")}
              </p>
            </div>

            {/* Gli ultimi usciti, numero e camera: il controllo al banco. */}
            {usatiRecenti.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", ...S.sub, marginBottom: 6 }}>
                  Ultimi usati
                </p>
                <div style={{ display: "grid", gap: 2 }}>
                  {(tuttiUsati ? usatiRecenti : usatiRecenti.slice(0, 10)).map((u) => (
                    <div key={u.id} style={{
                      display: "grid", gridTemplateColumns: "56px 1fr auto", alignItems: "center", gap: 8,
                      padding: "6px 8px", borderRadius: 8, fontSize: 13,
                      background: u === usatiRecenti[0] ? "color-mix(in srgb, var(--primary) 8%, transparent)" : "none",
                    }}>
                      <span style={{ fontWeight: 900, fontVariantNumeric: "tabular-nums", color: "var(--primary)" }}>N. {u.numero}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 700 }}>Camera {u.room}</span>
                        <span style={{ ...S.sub }}> · {u.emoji || EMOJI_TICKET_DEFAULT} {u.nome}</span>
                      </span>
                      <span style={{ fontSize: 12, ...S.sub, fontVariantNumeric: "tabular-nums" }}>
                        {u.usato_at ? new Date(u.usato_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}
                      </span>
                    </div>
                  ))}
                </div>
                {usatiRecenti.length > 10 && (
                  <button onClick={() => setTuttiUsati((v) => !v)}
                    style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "var(--gray-accessible-text)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                    {tuttiUsati ? "Mostra solo gli ultimi 10" : `Mostra tutti (${usatiRecenti.length})`}
                  </button>
                )}
              </div>
            )}

            <div style={{ display: "grid", gap: 12 }}>
              {menuEvento.map((m) => (
                <div key={m.id}>
                  {menuEvento.length > 1 && (
                    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", ...S.sub, marginBottom: 6 }}>
                      {m.nome}
                    </p>
                  )}
                  <div style={{ display: "grid", gap: 8 }}>
                    {m.ticket.map((tk) => {
                      const nt = perTicket(tk.id);
                      const quota = nt.pagati > 0 ? nt.usati / nt.pagati : 0;
                      return (
                        <div key={tk.id}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 4 }}>
                            <span style={{ fontSize: 18, lineHeight: 1, width: 24, textAlign: "center" }}>{tk.emoji || EMOJI_TICKET_DEFAULT}</span>
                            <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{tk.nome}</span>
                            <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{nt.usati}/{nt.pagati}</span>
                            <span style={{ fontSize: 11, ...S.sub }}>ritirati</span>
                          </div>
                          <div style={{ height: 6, borderRadius: 99, background: "var(--secondary)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.round(quota * 100)}%`, borderRadius: 99, background: "var(--primary)", transition: "width .3s ease" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {/* ── Partecipanti: i numeri, poi chi ha risposto ───────────────────── */}
      {evento && schedaAttiva === "partecipanti" && (
        <div style={{ ...S.card, padding: 14, marginBottom: 16 }}>
          {/* Quanti numeri dipende da quanti menu ha deciso il delegato: uno
              per menu (pagati/tot.), auto-fit invece di colonne fisse così
              vanno a capo invece di schiacciarsi. Senza glutine sta a lato,
              a parte: non è un menu ma si somma a qualunque menu (si può
              essere vegani E celiaci), ed è il numero che decide cosa
              comprare a parte — vegetariani/vegani invece non hanno un loro
              conteggio qui: si vedono sulla camera (pastiglie) e nella lista
              "Esigenze alimentari" più sotto. */}
          <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
            <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8 }}>
              <Statistica valore={partecipanti.length} etichetta="Partecipano" />
              {pagamentiAttivi && <Statistica valore={confermati} etichetta="Pagamenti confermati" />}
              {/* Con una quota indicata: quanto è già entrato su quanto
                  dovrebbe entrare, il numero che serve per la spesa. */}
              {pagamentiAttivi && fmtQuota(evento.quota) && (
                <Statistica valore={fmtQuota(confermati * Number(evento.quota))!}
                  etichetta={`Incassati su ${fmtQuota(partecipanti.length * Number(evento.quota))}`} />
              )}
              {menuEvento.map((m) => {
                const n = perMenu(m.id);
                return (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {pagamentiAttivi
                      ? <Statistica valore={`${n.pagati}/${n.totale}`} etichetta={`${m.nome} (pagati/tot.)`} />
                      : <Statistica valore={n.totale} etichetta={m.nome} />}
                  </div>
                );
              })}
            </div>
            <div title="Camere che non mangiano glutine, qualunque menu abbiano scelto"
              style={{
                flexShrink: 0, width: 88, borderRadius: 12, padding: "8px 6px",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                background: senzaGlutine > 0 ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "var(--secondary)",
                color: senzaGlutine > 0 ? "var(--primary)" : "var(--muted-foreground)",
              }}>
              <WheatOff size={16} />
              <p style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>{senzaGlutine}</p>
              <p style={{ fontSize: 11, textAlign: "center", lineHeight: 1.2 }}>Senza glutine</p>
            </div>
          </div>

        </div>
      )}

      {/* ── Chi ha risposto, per piano ───────────────────────────────────── */}
      {evento && schedaAttiva === "partecipanti" && (
        <div style={{ ...S.card, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <p style={{ fontSize: 12, ...S.sub }}>Chi ha risposto:</p>
            {/* Per chi non usa l'app, o ha dato la sua parola di persona:
                il delegato registra (o corregge) una camera a mano, invece
                di aspettare che aderisca da sola. */}
            <button onClick={() => setAggiungiCamera((v) => !v)} title="Aggiungi una camera a mano"
              style={{
                display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
                color: "var(--gray-accessible-text)", background: "none", border: "none", cursor: "pointer", padding: 0,
              }}>
              <UserPlus size={13} /> Aggiungi
            </button>
          </div>

          {aggiungiCamera && (
            <div style={{
              display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
              marginBottom: 14, padding: 10, borderRadius: 12, background: "var(--secondary)",
            }}>
              <input style={{ ...S.input, width: "auto", flex: 1, minWidth: 90 }} placeholder="Camera"
                value={nuovaCamera} onChange={(e) => scriviCamera(e.target.value)} />
              <select style={{ ...S.input, width: "auto", maxWidth: "100%" }} value={menuCameraEffettivo ?? ""}
                onChange={(e) => setNuovoMenuCamera(Number(e.target.value))}>
                {menuEvento.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
              <select style={{ ...S.input, width: "auto", maxWidth: "100%" }} value={nuovaDietaCamera}
                onChange={(e) => setNuovaDietaCamera(e.target.value as Dieta)}>
                <option value="classico">{NOME_DIETA.classico}</option>
                <option value="vegetariano">{NOME_DIETA.vegetariano}</option>
                <option value="vegano">{NOME_DIETA.vegano}</option>
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={nuovoGlutineCamera} onChange={(e) => setNuovoGlutineCamera(e.target.checked)} />
                <WheatOff size={13} /> Senza glutine
              </label>
              {cameraGiaIscritta && (
                <p style={{ flexBasis: "100%", fontSize: 11, ...S.sub }}>
                  La camera {cameraGiaIscritta.room} ha già risposto: le sue scelte vengono aggiornate.
                </p>
              )}
              <button onClick={aggiungiAdesione} disabled={busy || !nuovaCamera.trim()} style={{ ...S.btn, opacity: busy || !nuovaCamera.trim() ? 0.5 : 1 }}>
                {busy ? "In corso…" : "Aggiungi"}
              </button>
              <button onClick={() => { setAggiungiCamera(false); setNuovaCamera(""); }} style={S.btn}>Annulla</button>
            </div>
          )}

          {partecipanti.length === 0 && !aggiungiCamera && (
            <p style={{ fontSize: 12, ...S.sub }}>Ancora nessun partecipante.</p>
          )}

          {/* ── Filtri: menu E esigenza E ricerca, si sommano ─────────── */}
          {partecipanti.length > 0 && (
            <div style={{ display: "grid", gap: 8, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
              <div style={{ position: "relative" }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted-foreground)" }} />
                <input style={{ ...S.input, paddingLeft: 30 }} value={cerca} onChange={(e) => setCerca(e.target.value)}
                  placeholder="Cerca camera o parola nelle note (es. lattosio)" />
              </div>

              {menuEvento.length > 1 && (
                <div style={{ display: "flex", gap: 6, overflowX: "auto", alignItems: "center" }}>
                  <span style={{ fontSize: 11, ...S.sub, flexShrink: 0, width: 58 }}>Menu</span>
                  <Filtro attivo={menuFiltrato == null} onClick={() => setFiltroMenu(null)} n={quantiConMenu(null)}>Tutti</Filtro>
                  {menuEvento.map((m) => (
                    <Filtro key={m.id} attivo={menuFiltrato === m.id} n={quantiConMenu(m.id)}
                      onClick={() => setFiltroMenu(menuFiltrato === m.id ? null : m.id)}>
                      {m.nome}
                    </Filtro>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 6, overflowX: "auto", alignItems: "center" }}>
                <span style={{ fontSize: 11, ...S.sub, flexShrink: 0, width: 58 }}>Esigenze</span>
                {([
                  ["tutte", "Tutte"],
                  ["vegetariano", "Vegetariano"],
                  ["vegano", "Vegano"],
                  ["senza_glutine", "Senza glutine"],
                  ["note", "Con note"],
                  ["nessuna", "Nessuna"],
                ] as [FiltroEsigenza, string][]).map(([f, label]) => (
                  <Filtro key={f} attivo={filtroEsigenza === f} n={quantiConEsigenza(f)}
                    onClick={() => setFiltroEsigenza(filtroEsigenza === f && f !== "tutte" ? "tutte" : f)}>
                    {f === "senza_glutine" && <WheatOff size={12} />}
                    {f === "note" && <StickyNote size={12} />}
                    {label}
                  </Filtro>
                ))}
              </div>

              {pagamentiAttivi && (
                <div style={{ display: "flex", gap: 6, overflowX: "auto", alignItems: "center" }}>
                  <span style={{ fontSize: 11, ...S.sub, flexShrink: 0, width: 58 }}>Pagamento</span>
                  {([
                    ["tutti", "Tutti"],
                    ["da_confermare", "Ha dichiarato, da confermare"],
                    ["non_dichiarato", "Non ha dichiarato"],
                    ["confermato", "Confermato"],
                  ] as [FiltroPagamento, string][]).map(([f, label]) => (
                    <Filtro key={f} attivo={pagamentoFiltrato === f} n={quantiConPagamento(f)}
                      onClick={() => setFiltroPagamento(pagamentoFiltrato === f && f !== "tutti" ? "tutti" : f)}>
                      {f === "confermato" && <Check size={12} />}
                      {label}
                    </Filtro>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, ...S.sub, flexShrink: 0, width: 58 }}>Raggruppa</span>
                <Filtro attivo={raggruppa === "piano"} onClick={() => setRaggruppa("piano")}>Per piano</Filtro>
                <Filtro attivo={raggruppa === "menu"} onClick={() => setRaggruppa("menu")}>Per menu</Filtro>
                {filtriAttivi && (
                  <span style={{ marginLeft: "auto", fontSize: 12, ...S.sub }}>
                    {filtrati.length} di {partecipanti.length} ·{" "}
                    <button onClick={azzeraFiltri}
                      style={{ fontSize: 12, fontWeight: 700, color: "var(--gray-accessible-text)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                      Azzera filtri
                    </button>
                  </span>
                )}
              </div>
            </div>
          )}

          {partecipanti.length > 0 && filtrati.length === 0 && (
            <p style={{ fontSize: 12, ...S.sub }}>Nessuna camera corrisponde ai filtri.</p>
          )}

          {raggruppa === "piano" ? (
            <>
              {PIANI.map((p) => (
                <Gruppo key={p} titolo={nomePiano(p)} colore={colorePiano(p)} righe={filtrati.filter((a) => pianoDi(a.room) === p)} />
              ))}
              <Gruppo titolo="Altre" righe={fuoriSchema} />
            </>
          ) : (
            menuEvento.map((m) => (
              <Gruppo key={m.id} titolo={m.nome} righe={filtrati.filter((a) => a.menu_id === m.id)} />
            ))
          )}
        </div>
      )}

      {/* ── Esigenze alimentari: tutto quello che serve a chi cucina ────── */}
      {/* Segue gli stessi filtri della griglia: "Con note" + una ricerca
          ("lattosio") dà subito l'elenco da portare a chi fa la spesa. */}
      {evento && schedaAttiva === "partecipanti" && esigenzeFiltrate.length > 0 && (
        <div style={{ ...S.card, padding: 14, marginTop: 16 }}>
          <p style={{ fontSize: 12, ...S.sub, marginBottom: 10 }}>
            Esigenze alimentari · {esigenzeFiltrate.length}{filtriAttivi && ` (filtrate, su ${conEsigenze.length})`}
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {esigenzeFiltrate.map((a) => (
              <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700, minWidth: 44 }}>{a.room}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {nomeDieta(a) && <span style={{ fontWeight: 700, marginRight: 6 }}>{nomeDieta(a)}</span>}
                  {a.senza_glutine && (
                    <span style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <WheatOff size={12} /> senza glutine
                    </span>
                  )}
                  {a.note && (
                    <p style={{ marginTop: 2, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{a.note}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Conferma un pagamento — overlay in pagina, dalla pastiglia ──── */}
      {adesioneSelezionata && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 60, display: "flex",
          alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", padding: 20,
        }} onClick={() => !busy && setAdesioneSelezionata(null)}>
          <div style={{ ...S.card, padding: 20, maxWidth: 320, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Camera {adesioneSelezionata.room}</p>
            <p style={{ fontSize: 13, ...S.sub, marginBottom: 4 }}>
              Menu: {nomeMenu(adesioneSelezionata.menu_id)}
              {nomeDieta(adesioneSelezionata) && ` · ${nomeDieta(adesioneSelezionata)}`}
              {adesioneSelezionata.senza_glutine && " · senza glutine"}
            </p>
            {adesioneSelezionata.note && (
              <p style={{ fontSize: 13, marginBottom: 4, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                Note: {adesioneSelezionata.note}
              </p>
            )}
            {pagamentiAttivi && (
              <p style={{ fontSize: 13, ...S.sub, marginBottom: adesioneSelezionata.pagamento_confermato ? 4 : 16 }}>
                {adesioneSelezionata.pagamento_confermato
                  ? "Pagamento confermato."
                  : adesioneSelezionata.pagamento_dichiarato
                    ? "Ha dichiarato di aver pagato."
                    : "Non ha ancora dichiarato di aver pagato — puoi confermarlo comunque, ad esempio se ha pagato in mano o senza usare l'app."}
              </p>
            )}
            {/* I ticket si usano dallo schermo del residente, non da qui —
                uno per voce del menu scelto. Il delegato può solo rimettere
                "da usare" un ticket consumato (uno slider trascinato per
                errore): il numero che aveva preso non si riusa. Mostrato a
                prescindere da pagamentiAttivi: un ticket esiste se il
                pagamento è confermato, anche con i pagamenti dell'app
                spenti (es. confermato a mano per un incasso in contanti). */}
            {adesioneSelezionata.pagamento_confermato && adesioneSelezionata.ticket.length > 0 && (
              <div style={{ margin: "8px 0 16px", display: "grid", gap: 6 }}>
                {adesioneSelezionata.ticket.map((tk) => (
                  <div key={tk.id} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 10,
                    background: tk.usato ? "color-mix(in srgb, #22c55e 10%, transparent)" : "var(--secondary)",
                  }}>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{tk.emoji || EMOJI_TICKET_DEFAULT}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 700 }}>{tk.nome}</p>
                      <p style={{ fontSize: 11, ...S.sub }}>
                        {tk.usato
                          ? `N. ${tk.numero} · ritirato il ${tk.usato_at ? fmtData(tk.usato_at) : "—"}`
                          : "Non ancora ritirato"}
                      </p>
                    </div>
                    {tk.usato && (
                      <button onClick={() => ripristinaTicket(tk.id)} disabled={busy}
                        title="Rimettilo da usare (es. slider trascinato per errore)"
                        style={{ ...S.btn, display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: "5px 8px", opacity: busy ? 0.5 : 1 }}>
                        <RotateCcw size={12} /> Ripristina
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: pagamentiAttivi ? 0 : 12 }}>
              {pagamentiAttivi && !adesioneSelezionata.pagamento_confermato && (
                <button style={S.btn} disabled={busy} onClick={confermaSelezionata}>
                  {busy ? "In corso…" : "Conferma pagamento"}
                </button>
              )}
              {/* "Torna indietro" su una conferma data per errore — niente a
                  che fare con pagamentiAttivi (si può confermare anche con i
                  pagamenti dell'app spenti, quindi si deve poter annullare
                  allo stesso modo). Funziona anche se un ticket di questa
                  adesione è già stato usato: li cancella tutti, usati
                  compresi. */}
              {adesioneSelezionata.pagamento_confermato && (
                <button style={S.btn} disabled={busy} onClick={annullaConfermaSelezionata}>
                  {busy ? "In corso…" : "Annulla conferma"}
                </button>
              )}
              <button style={S.danger} disabled={busy} onClick={rimuoviSelezionata}>
                {busy ? "In corso…" : "Rimuovi camera"}
              </button>
              <button style={S.btn} disabled={busy} onClick={() => setAdesioneSelezionata(null)}>
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Conferma eliminazione — overlay in pagina, non window.confirm() */}
      {daEliminare && evento && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 60, display: "flex",
          alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", padding: 20,
        }} onClick={() => !busy && setDaEliminare(false)}>
          <div style={{ ...S.card, padding: 20, maxWidth: 340, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Eliminare "{evento.titolo}"?</p>
            <p style={{ fontSize: 13, ...S.sub, marginBottom: 16 }}>
              Sparisce anche l'elenco di chi ha aderito, con menu e stato dei
              pagamenti. Non si può annullare.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={S.danger} disabled={busy} onClick={elimina}>
                {busy ? "In corso…" : "Elimina"}
              </button>
              <button style={S.btn} disabled={busy} onClick={() => setDaEliminare(false)}>
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
