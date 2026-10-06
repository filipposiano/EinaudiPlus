import { useEffect, useState } from "react";
import { Pencil, Plus, Check, UserPlus, WheatOff, StickyNote, X, Ticket } from "lucide-react";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";
import { PIANI, pianoDi, nomePiano, colorePiano, type Piano } from "../../../piani";

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
type MenuTicketVoce = { id: number; nome: string };
type MenuVoce = { id: number; nome: string; ticket: MenuTicketVoce[] };
type Dieta = "classico" | "vegetariano" | "vegano";
const NOME_DIETA: Record<Dieta, string> = { classico: "Mangia di tutto", vegetariano: "Vegetariano", vegano: "Vegano" };

// v1.1: un'adesione è, per definizione, una camera che partecipa — non
// esiste più "partecipa=false" (vedi la nota gemella in
// src/modules/grigliata/application/iscriviti.js). Il menu quindi non è
// più opzionale. v1.3: "senza glutine" e una nota libera, scritti dal
// residente — qui si leggono soltanto. v1.3.1: "dieta" torna un campo a sé
// (nel pannello non si segna 'classico', si segnano solo gli altri due).
// v1.5: i ticket di questa adesione — uno per voce del menu scelto, creati
// tutti insieme alla conferma del pagamento (lo decide la UI che il pagamento
// sia confermato, non una colonna in più); `numero` resta null finché il
// residente non preme "Usa" su quella voce dal proprio schermo (vedi
// Grigliata.tsx lato residente — qui si legge soltanto, il tocco non è
// dell'admin).
type AdesioneTicket = { id: number; nome: string; usato: boolean; numero: number | null; usato_at: string | null };

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
  paypal_link: string | null; satispay_link: string | null;
  chiuso: boolean; attiva: boolean;
  menu: MenuVoce[];
};

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

type VoceTicketEditor = { chiave: number; id?: number; nome: string };
type VoceEditor = { chiave: number; id?: number; nome: string; ticket: VoceTicketEditor[] };

const MENU_MAX = 10;
const TICKET_MAX = 10;
const MENU_DI_DEFAULT = ["Carne", "Pesce"];
let prossimaChiave = 1;

const voceTicketNuova = (nome: string, id?: number): VoceTicketEditor => ({ chiave: prossimaChiave++, id, nome });
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
    ticket: v.ticket.map((t) => (t.id ? { id: t.id, nome: t.nome } : { nome: t.nome })),
  }));

function EditorMenu({ voci, onChange, scelte, ticketScelte }: {
  voci: VoceEditor[];
  onChange: (voci: VoceEditor[]) => void;
  /** Quante camere hanno già scelto ciascun menu (per id), solo in modifica. */
  scelte?: Record<number, number>;
  /** Quante adesioni hanno già un ticket di ciascuna voce (per id), solo in modifica. */
  ticketScelte?: Record<number, number>;
}) {
  const rinomina = (chiave: number, nome: string) =>
    onChange(voci.map((v) => (v.chiave === chiave ? { ...v, nome } : v)));
  const togli = (chiave: number) => onChange(voci.filter((v) => v.chiave !== chiave));
  const rinominaTicket = (chiaveMenu: number, chiaveTicket: number, nome: string) =>
    onChange(voci.map((v) => (v.chiave === chiaveMenu
      ? { ...v, ticket: v.ticket.map((t) => (t.chiave === chiaveTicket ? { ...t, nome } : t)) }
      : v)));
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
                  const usatoTicket = (t.id && ticketScelte?.[t.id]) || 0;
                  const bloccatoTicket = usatoTicket > 0 || v.ticket.length === 1;
                  return (
                    <div key={t.chiave} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <Ticket size={12} style={{ flexShrink: 0, color: "var(--muted-foreground)" }} />
                      <input style={{ ...S.input, flex: 1, minWidth: 0, background: "var(--card)" }} value={t.nome} maxLength={40}
                        onChange={(e) => rinominaTicket(v.chiave, t.chiave, e.target.value)}
                        placeholder="Es. Salsiccia" />
                      <button onClick={() => toglieTicket(v.chiave, t.chiave)} disabled={bloccatoTicket}
                        title={usatoTicket > 0 ? `Già assegnato a ${usatoTicket} ${usatoTicket === 1 ? "adesione" : "adesioni"}: non si può togliere` : "Togli questo ticket"}
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

function fmtData(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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

  // Aggiunta a mano di una camera — per chi non usa l'app, o per registrare
  // chi ha dato la sua parola di persona. Sempre "partecipa", con un menu:
  // e' quello che grigliata_admin_aggiungi_adesione fa (vedi il commento
  // gemello lato SQL).
  const [aggiungiCamera, setAggiungiCamera] = useState(false);
  const [nuovaCamera, setNuovaCamera] = useState("");
  // null = il menu di base (gli id si conoscono solo dopo il caricamento).
  const [nuovoMenuCamera, setNuovoMenuCamera] = useState<number | null>(null);
  const [nuovaDietaCamera, setNuovaDietaCamera] = useState<Dieta>("classico");

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

  const carica = () =>
    call<Overview>("grigliataOverview")
      .then((r) => setOverview(r))
      .catch((e: any) => setMsg(e.message));

  useEffect(() => { carica(); }, []);

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
        paypal_link: paypal, satispay_link: satispay,
        menu: vociDaInviare(menuNuovi),
      });
      setMostraForm(false);
      setPaypal(""); setSatispay(""); setTitoloModificato(false);
      setMenuNuovi(vociDiDefault());
      setGiornoEvento(giornoEventoDiDefault());
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

  function apriModificaEvento() {
    if (!overview?.evento) return;
    setNuovoTitolo(overview.evento.titolo);
    setNuovaScadenza(isoInDatetimeLocal(overview.evento.scadenza));
    setNuovoGiornoEvento(overview.evento.giorno_evento);
    setMenuModifica(overview.evento.menu.map((m) =>
      voceNuova(m.nome, m.id, m.ticket.map((t) => voceTicketNuova(t.nome, t.id)))));
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

  async function aggiungiAdesione() {
    if (!overview?.evento || busy || menuCameraEffettivo == null) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataAggiungiAdesione", {
        evento_id: overview.evento.id, room: nuovaCamera, menu_id: menuCameraEffettivo, dieta: nuovaDietaCamera,
      });
      setAggiungiCamera(false);
      setNuovaCamera("");
      setNuovaDietaCamera("classico");
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

  const evento = overview?.evento ?? null;
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

  const confermati = partecipanti.filter((a) => a.pagamento_confermato).length;
  const perMenu = (id: number) => {
    const del = partecipanti.filter((a) => a.menu_id === id);
    return { totale: del.length, pagati: del.filter((a) => a.pagamento_confermato).length };
  };
  /** Quante adesioni hanno un ticket di QUESTA voce (= pagate, i ticket
   *  esistono solo a pagamento confermato) e quante l'hanno già ritirato —
   *  il numero che conta il giorno della grigliata, distinto da "pagati". */
  const perTicket = (ticketId: number) => {
    let pagati = 0, usati = 0;
    for (const a of partecipanti) {
      const tk = a.ticket.find((t) => t.id === ticketId);
      if (tk) { pagati++; if (tk.usato) usati++; }
    }
    return { pagati, usati };
  };
  const scelteDi: Record<number, number> = {};
  for (const a of partecipanti) scelteDi[a.menu_id] = (scelteDi[a.menu_id] ?? 0) + 1;
  const ticketScelteDi: Record<number, number> = {};
  for (const a of partecipanti) for (const tk of a.ticket) ticketScelteDi[tk.id] = (ticketScelteDi[tk.id] ?? 0) + 1;
  const senzaGlutine = partecipanti.filter((a) => a.senza_glutine).length;
  // Chi ha qualcosa di cui chi cucina deve tenere conto: una dieta diversa
  // da "classico", senza glutine, o una nota. È la lista da leggere prima
  // di fare la spesa, quindi sta tutta insieme invece di dover aprire una
  // pastiglia alla volta.
  const conEsigenze = partecipanti.filter((a) => a.dieta !== "classico" || a.senza_glutine || a.note);

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
    const confermato = a.pagamento_confermato;
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
        {!confermato && a.pagamento_dichiarato && (
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
        {confermato && (
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
  const GruppoPiano = ({ piano, righe }: { piano: Piano; righe: Adesione[] }) => {
    if (righe.length === 0) return null;
    const colore = colorePiano(piano);
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: 99, background: colore, flexShrink: 0 }} />
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", ...S.sub }}>
            {nomePiano(piano)} · {righe.length}
          </p>
        </div>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))" }}>
          {righe.map((a) => <AdesioneChip key={a.id} a={a} colore={colore} />)}
        </div>
      </div>
    );
  };

  const fuoriSchema = partecipanti.filter((a) => pianoDi(a.room) === null);

  return (
    <>
      {/* Titolo a sinistra, "+" a destra: su desktop questa scheda non ha
          una topbar sopra di sé (a differenza del layout mobile, che il
          nome della sezione lo mostra già lì) — un pulsante da solo,
          allineato tutto a destra, lasciava uno spazio vuoto grande quanto
          la larghezza della pagina. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>Grigliata</h2>
        <button onClick={() => setMostraForm(true)} title="Fai partire una nuova grigliata"
          style={{
            width: 34, height: 34, borderRadius: 99, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--primary)", color: "var(--primary-foreground)",
            border: "none", cursor: "pointer",
          }}>
          <Plus size={18} />
        </button>
      </div>

      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16, maxWidth: "70ch" }}>
        Finché è attiva, i residenti trovano la scheda "Grigliata" nel menu, dove
        aderiscono, scelgono il menu e dichiarano di aver pagato. Qui vedi il
        riepilogo, chi ha risposto, e confermi i pagamenti — la conferma avvisa
        subito la camera.
      </p>

      {msg && <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      {/* ── Fai partire una nuova grigliata (dal "+" qui sopra) ──────────── */}
      {mostraForm && (
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
            <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Scadenza delle adesioni</label>
            <input style={S.input} type="datetime-local" value={scadenza} onChange={(e) => cambiaScadenzaForm(e.target.value)} />
          </div>

          <div>
            <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Giorno della grigliata</label>
            <input style={S.input} type="date" value={giornoEvento} onChange={(e) => setGiornoEvento(e.target.value)} />
            <p style={{ fontSize: 11, ...S.sub, marginTop: 4 }}>
              Il giorno vero in cui si mangia — può cadere dopo la scadenza delle adesioni.
              È il giorno in cui, sulla scheda dei residenti, la conferma del pagamento lascia
              il posto al ticket da usare.
            </p>
          </div>

          <EditorMenu voci={menuNuovi} onChange={setMenuNuovi} />

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

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={creaEvento} disabled={busy} style={{ ...S.btn, opacity: busy ? 0.5 : 1 }}>
              {busy ? "Avvio…" : "Avvia"}
            </button>
            <button onClick={() => setMostraForm(false)} style={S.btn}>Annulla</button>
          </div>
        </div>
      )}

      {/* ── Riepilogo ────────────────────────────────────────────────────── */}
      {evento ? (
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
                Scade {fmtData(evento.scadenza)} · Si mangia il {fmtGiorno(evento.giorno_evento)}
              </p>
            </>
          )}

          {/* Quanti numeri dipende da quanti menu ha deciso il delegato: uno
              per menu (pagati/tot.), auto-fit invece di colonne fisse così
              vanno a capo invece di schiacciarsi. Senza glutine sta a lato,
              a parte: non è un menu ma si somma a qualunque menu (si può
              essere vegani E celiaci), ed è il numero che decide cosa
              comprare a parte — vegetariani/vegani invece non hanno un loro
              conteggio qui: si vedono sulla camera (pastiglie) e nella lista
              "Esigenze alimentari" più sotto. */}
          <div style={{ display: "flex", gap: 10, alignItems: "stretch", paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8 }}>
              <Statistica valore={partecipanti.length} etichetta="Partecipano" />
              <Statistica valore={confermati} etichetta="Pagamenti confermati" />
              {menuEvento.map((m) => {
                const n = perMenu(m.id);
                return (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <Statistica valore={`${n.pagati}/${n.totale}`} etichetta={`${m.nome} (pagati/tot.)`} />
                    {/* Quante porzioni di CIASCUNA voce-ticket sono DAVVERO
                        uscite al banco, non solo pagate — il numero che
                        conta il giorno della grigliata. */}
                    {m.ticket.map((tk) => {
                      const nt = perTicket(tk.id);
                      if (nt.pagati === 0) return null;
                      return (
                        <p key={tk.id} style={{ fontSize: 10, textAlign: "center", ...S.sub, display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                          <Ticket size={10} /> {tk.nome}: {nt.usati}/{nt.pagati} ritirati
                        </p>
                      );
                    })}
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

          {evento.chiuso && (
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={() => setDaEliminare(true)} disabled={busy} style={{ ...S.danger, opacity: busy ? 0.5 : 1 }}>
                Elimina
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ ...S.card, padding: 16, marginBottom: 16, fontSize: 13, ...S.sub, textAlign: "center" }}>
          Non c'è ancora nessuna grigliata. Falla partire dal "+" qui sopra.
        </div>
      )}

      {/* ── Chi ha risposto, per piano ───────────────────────────────────── */}
      {evento && (
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
                value={nuovaCamera} onChange={(e) => setNuovaCamera(e.target.value)} />
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
              <button onClick={aggiungiAdesione} disabled={busy || !nuovaCamera.trim()} style={{ ...S.btn, opacity: busy || !nuovaCamera.trim() ? 0.5 : 1 }}>
                {busy ? "In corso…" : "Aggiungi"}
              </button>
              <button onClick={() => { setAggiungiCamera(false); setNuovaCamera(""); }} style={S.btn}>Annulla</button>
            </div>
          )}

          {partecipanti.length === 0 && !aggiungiCamera && (
            <p style={{ fontSize: 12, ...S.sub }}>Ancora nessun partecipante.</p>
          )}

          {PIANI.map((p) => (
            <GruppoPiano key={p} piano={p} righe={partecipanti.filter((a) => pianoDi(a.room) === p)} />
          ))}
          {fuoriSchema.length > 0 && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", ...S.sub, marginBottom: 8 }}>
                Altre · {fuoriSchema.length}
              </p>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))" }}>
                {fuoriSchema.map((a) => <AdesioneChip key={a.id} a={a} colore="var(--foreground)" />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Esigenze alimentari: tutto quello che serve a chi cucina ────── */}
      {evento && conEsigenze.length > 0 && (
        <div style={{ ...S.card, padding: 14, marginTop: 16 }}>
          <p style={{ fontSize: 12, ...S.sub, marginBottom: 10 }}>
            Esigenze alimentari · {conEsigenze.length}
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {conEsigenze.map((a) => (
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
            <p style={{ fontSize: 13, ...S.sub, marginBottom: adesioneSelezionata.pagamento_confermato ? 4 : 16 }}>
              {adesioneSelezionata.pagamento_confermato
                ? "Pagamento confermato."
                : adesioneSelezionata.pagamento_dichiarato
                  ? "Ha dichiarato di aver pagato."
                  : "Non ha ancora dichiarato di aver pagato — puoi confermarlo comunque, ad esempio se ha pagato in mano o senza usare l'app."}
            </p>
            {/* I ticket si usano dallo schermo del residente, non da qui —
                questo elenco è solo informativo (vedi Grigliata.tsx lato
                residente), uno per voce del menu scelto. */}
            {adesioneSelezionata.pagamento_confermato && (
              <div style={{ marginBottom: 16, display: "grid", gap: 3 }}>
                {adesioneSelezionata.ticket.map((tk) => (
                  <p key={tk.id} style={{ fontSize: 13, ...S.sub, display: "flex", alignItems: "center", gap: 5 }}>
                    <Ticket size={13} />
                    {tk.usato ? `${tk.nome}: ticket n. ${tk.numero} già ritirato.` : `${tk.nome}: non ancora ritirato.`}
                  </p>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!adesioneSelezionata.pagamento_confermato && (
                <button style={S.btn} disabled={busy} onClick={confermaSelezionata}>
                  {busy ? "In corso…" : "Conferma pagamento"}
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
