import { useEffect, useState } from "react";
import { Pencil, Plus, Check, UserPlus, WheatOff, StickyNote } from "lucide-react";
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

// "classico" = mangia tutto: il valore storico, già salvato nelle adesioni.
type Menu = "classico" | "vegetariano" | "vegano";

const NOME_MENU: Record<Menu, string> = { classico: "Mangia tutto", vegetariano: "Vegetariano", vegano: "Vegano" };
const MENU_ORDINE: Menu[] = ["classico", "vegetariano", "vegano"];

// v1.1: un'adesione è, per definizione, una camera che partecipa — non
// esiste più "partecipa=false" (vedi la nota gemella in
// src/modules/grigliata/application/iscriviti.js). Il menu quindi non è
// più opzionale. v1.3: "senza glutine" e una nota libera, scritti dal
// residente — qui si leggono soltanto.
type Adesione = {
  id: number; room: string; menu: Menu;
  senza_glutine: boolean; note: string | null;
  pagamento_dichiarato: boolean; pagamento_confermato: boolean;
  confermato_da: string | null; confermato_at: string | null;
};

type Evento = {
  id: number; titolo: string; scadenza: string;
  paypal_link: string | null; satispay_link: string | null;
  chiuso: boolean; attiva: boolean;
};

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

  // Aggiunta a mano di una camera — per chi non usa l'app, o per registrare
  // chi ha dato la sua parola di persona. Sempre "partecipa", con un menu:
  // e' quello che grigliata_admin_aggiungi_adesione fa (vedi il commento
  // gemello lato SQL).
  const [aggiungiCamera, setAggiungiCamera] = useState(false);
  const [nuovaCamera, setNuovaCamera] = useState("");
  const [nuovoMenuCamera, setNuovoMenuCamera] = useState<Menu>("classico");

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
  const [paypal, setPaypal] = useState("");
  const [satispay, setSatispay] = useState("");

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
        titolo, scadenza: new Date(scadenza).toISOString(),
        paypal_link: paypal, satispay_link: satispay,
      });
      setMostraForm(false);
      setPaypal(""); setSatispay(""); setTitoloModificato(false);
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
    setModificaEvento(true);
  }

  async function salvaEvento() {
    if (!overview?.evento || busy) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataModifica", {
        evento_id: overview.evento.id, titolo: nuovoTitolo, scadenza: new Date(nuovaScadenza).toISOString(),
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
    if (!overview?.evento || busy) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataAggiungiAdesione", {
        evento_id: overview.evento.id, room: nuovaCamera, menu: nuovoMenuCamera,
      });
      setAggiungiCamera(false);
      setNuovaCamera("");
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

  const confermati = partecipanti.filter((a) => a.pagamento_confermato).length;
  const perMenu = (m: Menu) => {
    const del = partecipanti.filter((a) => a.menu === m);
    return { totale: del.length, pagati: del.filter((a) => a.pagamento_confermato).length };
  };
  const senzaGlutine = partecipanti.filter((a) => a.senza_glutine).length;
  // Chi ha scritto qualcosa per chi cucina: senza glutine o una nota. È la
  // lista da leggere prima di fare la spesa, quindi sta tutta insieme invece
  // di dover aprire una pastiglia alla volta.
  const conEsigenze = partecipanti.filter((a) => a.senza_glutine || a.note);

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
        <span style={{
          fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em",
          color: confermato ? colore : "var(--muted-foreground)",
        }}>
          {NOME_MENU[a.menu]}
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
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input style={{ ...S.input, width: "auto", flex: 1, minWidth: 180 }} type="datetime-local"
                  value={nuovaScadenza} onChange={(e) => setNuovaScadenza(e.target.value)} />
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
              <p style={{ fontSize: 12, ...S.sub, marginBottom: 14 }}>Scade {fmtData(evento.scadenza)}</p>
            </>
          )}

          {/* Sei numeri invece di quattro: auto-fit invece di 4 colonne
              fisse, così su telefono vanno a capo invece di schiacciarsi. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <Statistica valore={partecipanti.length} etichetta="Partecipano" />
            <Statistica valore={confermati} etichetta="Pagamenti confermati" />
            {MENU_ORDINE.map((m) => {
              const n = perMenu(m);
              return <Statistica key={m} valore={`${n.pagati}/${n.totale}`} etichetta={`${NOME_MENU[m]} (pagati/tot.)`} />;
            })}
            <Statistica valore={senzaGlutine} etichetta="Senza glutine" />
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
              <select style={{ ...S.input, width: "auto" }} value={nuovoMenuCamera}
                onChange={(e) => setNuovoMenuCamera(e.target.value as Menu)}>
                {MENU_ORDINE.map((m) => <option key={m} value={m}>{NOME_MENU[m]}</option>)}
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
                  <span style={S.sub}>{NOME_MENU[a.menu]}</span>
                  {a.senza_glutine && (
                    <span style={{ marginLeft: 6, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>
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
              Menu: {NOME_MENU[adesioneSelezionata.menu]}
              {adesioneSelezionata.senza_glutine && " · senza glutine"}
            </p>
            {adesioneSelezionata.note && (
              <p style={{ fontSize: 13, marginBottom: 4, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                Note: {adesioneSelezionata.note}
              </p>
            )}
            <p style={{ fontSize: 13, ...S.sub, marginBottom: 16 }}>
              {adesioneSelezionata.pagamento_confermato
                ? "Pagamento confermato."
                : adesioneSelezionata.pagamento_dichiarato
                  ? "Ha dichiarato di aver pagato."
                  : "Non ha ancora dichiarato di aver pagato — puoi confermarlo comunque, ad esempio se ha pagato in mano o senza usare l'app."}
            </p>
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
