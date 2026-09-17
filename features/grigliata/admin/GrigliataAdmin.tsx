import { useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
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

type Menu = "classico" | "vegano";

type Adesione = {
  id: number; room: string; partecipa: boolean; menu: Menu | null;
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

  // Modifica della scadenza dell'evento corrente — a parte dal form di
  // creazione qui sotto: qui si cambia una data su un evento che esiste già,
  // non se ne fa partire uno nuovo.
  const [modificaScadenza, setModificaScadenza] = useState(false);
  const [nuovaScadenza, setNuovaScadenza] = useState("");

  // "Elimina" chiede conferma DENTRO la pagina, non con window.confirm():
  // e' bloccato in diversi contesti (PWA installata, iframe senza
  // allow-modals) e in quel caso torna false senza mostrare niente — il
  // pulsante sembra semplicemente non funzionare. Stessa scelta già fatta
  // in Manutenzione.tsx per lo stesso motivo.
  const [daEliminare, setDaEliminare] = useState(false);

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

  function apriModificaScadenza() {
    if (!overview?.evento) return;
    setNuovaScadenza(isoInDatetimeLocal(overview.evento.scadenza));
    setModificaScadenza(true);
  }

  async function salvaScadenza() {
    if (!overview?.evento || busy) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataModificaScadenza", {
        evento_id: overview.evento.id, scadenza: new Date(nuovaScadenza).toISOString(),
      });
      setModificaScadenza(false);
      await carica();
      setMsg("Scadenza aggiornata.");
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confermaPagamento(adesioneId: number) {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataConfermaPagamento", { adesione_id: adesioneId });
      await carica();
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  const evento = overview?.evento ?? null;
  const adesioni = overview?.adesioni ?? [];

  const partecipanti = adesioni.filter((a) => a.partecipa);
  const confermati = partecipanti.filter((a) => a.pagamento_confermato).length;
  const perMenu = (m: Menu) => {
    const del = partecipanti.filter((a) => a.menu === m);
    return { totale: del.length, pagati: del.filter((a) => a.pagamento_confermato).length };
  };
  const classico = perMenu("classico");
  const vegano = perMenu("vegano");

  const Statistica = ({ valore, etichetta }: { valore: string | number; etichetta: string }) => (
    <div style={{ textAlign: "center" }}>
      <p style={{ fontSize: 22, fontWeight: 800 }}>{valore}</p>
      <p style={{ fontSize: 11, ...S.sub }}>{etichetta}</p>
    </div>
  );

  // Una riga "camera 214 — menu / stato pagamento", riusata nei tre
  // sottogruppi qui sotto (confermati, da confermare, non partecipano).
  const RigaAdesione = ({ a }: { a: Adesione }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 0" }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600 }}>Camera {a.room}</p>
        {a.partecipa && <p style={{ fontSize: 12, ...S.sub }}>Menu: {a.menu === "vegano" ? "Vegano" : "Classico"}</p>}
      </div>
      {a.partecipa && !a.pagamento_confermato && (
        <button onClick={() => confermaPagamento(a.id)} disabled={busy}
          style={{ ...S.btn, flexShrink: 0, opacity: busy ? 0.5 : 1 }}>
          Conferma pagamento
        </button>
      )}
      {a.pagamento_confermato && (
        <span style={{ fontSize: 12, fontWeight: 700, color: "#22c55e", flexShrink: 0 }}>✓ confermato</span>
      )}
    </div>
  );

  const Sottogruppo = ({ etichetta, righe }: { etichetta: string; righe: Adesione[] }) =>
    righe.length === 0 ? null : (
      <div style={{ marginBottom: 6 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", ...S.sub, marginTop: 8 }}>
          {etichetta} · {righe.length}
        </p>
        {righe.map((a) => <RigaAdesione key={a.id} a={a} />)}
      </div>
    );

  // Un gruppo per piano — stesso ordine e stessa idea di BiciTab.tsx:
  // "Manica" (un edificio a se') prima dei piani veri e propri, che
  // salgono dal primo al quarto, poi il basso fabbricato. Dentro ogni
  // piano, tre sotto-elenchi: confermati, da confermare, non partecipano —
  // le due domande che il delegato si fa girando per i piani.
  const GruppoPiano = ({ piano, righe }: { piano: Piano; righe: Adesione[] }) => {
    if (righe.length === 0) return null;
    const partecipanoQui = righe.filter((a) => a.partecipa);
    const confermatiQui = partecipanoQui.filter((a) => a.pagamento_confermato);
    const daConfermareQui = partecipanoQui.filter((a) => !a.pagamento_confermato);
    const nonPartecipanoQui = righe.filter((a) => !a.partecipa);
    const colore = colorePiano(piano);
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
          <span style={{ width: 9, height: 9, borderRadius: 99, background: colore, flexShrink: 0 }} />
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", ...S.sub }}>
            {nomePiano(piano)} · {righe.length}
          </p>
        </div>
        <Sottogruppo etichetta="Confermati" righe={confermatiQui} />
        <Sottogruppo etichetta="Da confermare" righe={daConfermareQui} />
        <Sottogruppo etichetta="Non partecipano" righe={nonPartecipanoQui} />
      </div>
    );
  };

  const fuoriSchema = adesioni.filter((a) => pianoDi(a.room) === null);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
            <p style={{ fontSize: 16, fontWeight: 700 }}>{evento.titolo}</p>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, flexShrink: 0,
              background: evento.attiva ? "color-mix(in srgb, #22c55e 18%, transparent)" : "var(--secondary)",
              color: evento.attiva ? "#16a34a" : "var(--muted-foreground)",
            }}>
              {evento.attiva ? "ATTIVA" : "CHIUSA"}
            </span>
          </div>

          {modificaScadenza ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
              <input style={{ ...S.input, width: "auto", flex: 1, minWidth: 180 }} type="datetime-local"
                value={nuovaScadenza} onChange={(e) => setNuovaScadenza(e.target.value)} />
              <button onClick={salvaScadenza} disabled={busy} style={{ ...S.btn, opacity: busy ? 0.5 : 1 }}>Salva</button>
              <button onClick={() => setModificaScadenza(false)} style={S.btn}>Annulla</button>
            </div>
          ) : (
            <button onClick={apriModificaScadenza}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, ...S.sub, marginBottom: 14, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Scade {fmtData(evento.scadenza)} <Pencil size={12} />
            </button>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <Statistica valore={partecipanti.length} etichetta="Partecipano" />
            <Statistica valore={confermati} etichetta="Pagamenti confermati" />
            <Statistica valore={`${classico.pagati}/${classico.totale}`} etichetta="Menu classico (pagati/tot.)" />
            <Statistica valore={`${vegano.pagati}/${vegano.totale}`} etichetta="Menu vegano (pagati/tot.)" />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            {!evento.chiuso && (
              <button onClick={chiudi} disabled={busy} style={{ ...S.danger, opacity: busy ? 0.5 : 1 }}>
                Chiudi ora
              </button>
            )}
            {evento.chiuso && (
              <>
                <button onClick={riapri} disabled={busy} style={{ ...S.btn, opacity: busy ? 0.5 : 1 }}>
                  Riapri
                </button>
                <button onClick={() => setDaEliminare(true)} disabled={busy} style={{ ...S.danger, opacity: busy ? 0.5 : 1 }}>
                  Elimina
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ ...S.card, padding: 16, marginBottom: 16, fontSize: 13, ...S.sub, textAlign: "center" }}>
          Non c'è ancora nessuna grigliata. Falla partire dal "+" qui sopra.
        </div>
      )}

      {/* ── Chi ha risposto, per piano ───────────────────────────────────── */}
      {adesioni.length > 0 && (
        <div style={{ ...S.card, padding: 14 }}>
          <p style={{ fontSize: 12, ...S.sub, marginBottom: 10 }}>Chi ha risposto:</p>
          {PIANI.map((p) => (
            <GruppoPiano key={p} piano={p} righe={adesioni.filter((a) => pianoDi(a.room) === p)} />
          ))}
          {fuoriSchema.length > 0 && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", ...S.sub, marginBottom: 4 }}>
                Altre · {fuoriSchema.length}
              </p>
              {fuoriSchema.map((a) => <RigaAdesione key={a.id} a={a} />)}
            </div>
          )}
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
