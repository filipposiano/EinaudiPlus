import { useEffect, useState } from "react";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";

// ─── Grigliata (delegato) ──────────────────────────────────────────────────────
//
// Riservata a delegato e sistemista (vedi
// src/modules/grigliata/domain/policy.js). Una alla volta: far partire una
// nuova grigliata chiude automaticamente quella ancora attiva — lo fa la
// funzione SQL, non questo componente, quindi non c'è un "sei sicuro?" da
// mostrare qui: è già così per costruzione.

type Adesione = {
  id: number; room: string; partecipa: boolean; menu: "classico" | "vegano" | null;
  pagamento_dichiarato: boolean; pagamento_confermato: boolean;
  confermato_da: string | null; confermato_at: string | null;
};

type Evento = {
  id: number; titolo: string; scadenza: string;
  paypal_link: string | null; satispay_link: string | null;
  chiuso: boolean; attiva: boolean;
};

type Overview = { evento: Evento | null; adesioni: Adesione[] };

/** Il valore di default per il campo `<input type="datetime-local">`: fra
 *  tre giorni alle 18:00 — un punto di partenza plausibile, non vincolante. */
function scadenzaDiDefault(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(18, 0, 0, 0);
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

  // Form "fai partire una nuova grigliata" — visibile sempre: anche con una
  // già attiva, crearne un'altra la chiude e riparte da questa.
  const [mostraForm, setMostraForm] = useState(false);
  const [titolo, setTitolo] = useState("Grigliata");
  const [scadenza, setScadenza] = useState(scadenzaDiDefault());
  const [paypal, setPaypal] = useState("");
  const [satispay, setSatispay] = useState("");

  const carica = () =>
    call<Overview>("grigliataOverview")
      .then((r) => { setOverview(r); if (!r.evento) setMostraForm(true); })
      .catch((e: any) => setMsg(e.message));

  useEffect(() => { carica(); }, []);

  async function creaEvento() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await call("grigliataCrea", {
        titolo, scadenza: new Date(scadenza).toISOString(),
        paypal_link: paypal, satispay_link: satispay,
      });
      setMostraForm(false);
      setPaypal(""); setSatispay("");
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

  return (
    <>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16, maxWidth: "70ch" }}>
        Finché è attiva, i residenti trovano la scheda "Grigliata" nel menu, dove
        aderiscono, scelgono il menu e dichiarano di aver pagato. Qui vedi chi ha
        aderito e confermi i pagamenti — la conferma avvisa subito la camera.
      </p>

      {msg && <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      {evento && (
        <div style={{ ...S.card, padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 700 }}>{evento.titolo}</p>
              <p style={{ fontSize: 12, ...S.sub }}>
                {evento.attiva ? "Attiva" : "Chiusa"} · scade {fmtData(evento.scadenza)}
              </p>
            </div>
            {evento.attiva && (
              <button onClick={chiudi} disabled={busy} style={{ ...S.danger, opacity: busy ? 0.5 : 1 }}>
                Chiudi ora
              </button>
            )}
          </div>
          <p style={{ fontSize: 12, ...S.sub }}>
            {partecipanti.length} adesion{partecipanti.length === 1 ? "e" : "i"} su {adesioni.length} rispost
            {adesioni.length === 1 ? "a" : "e"}
          </p>
        </div>
      )}

      {!mostraForm && (
        <button onClick={() => setMostraForm(true)} style={{ ...S.btn, marginBottom: 16 }}>
          {evento ? "Fai partire una nuova grigliata" : "Fai partire la prima grigliata"}
        </button>
      )}

      {mostraForm && (
        <div style={{ ...S.card, padding: 14, marginBottom: 16, display: "grid", gap: 12 }}>
          {evento?.attiva && (
            <p style={{ fontSize: 12, color: "var(--destructive-text)" }}>
              C'è già una grigliata attiva: farne partire una nuova la chiude subito.
            </p>
          )}

          <div>
            <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Titolo</label>
            <input style={S.input} value={titolo} onChange={(e) => setTitolo(e.target.value)} placeholder="Grigliata" />
          </div>

          <div>
            <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Scadenza delle adesioni</label>
            <input style={S.input} type="datetime-local" value={scadenza} onChange={(e) => setScadenza(e.target.value)} />
          </div>

          <div>
            <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Link PayPal</label>
            <input style={S.input} value={paypal} onChange={(e) => setPaypal(e.target.value)} placeholder="https://paypal.me/..." />
          </div>

          <div>
            <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Link Satispay</label>
            <input style={S.input} value={satispay} onChange={(e) => setSatispay(e.target.value)} placeholder="https://satispay.com/..." />
          </div>
          <p style={{ fontSize: 11, ...S.sub, marginTop: -6 }}>Serve almeno uno dei due link.</p>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={creaEvento} disabled={busy} style={{ ...S.btn, opacity: busy ? 0.5 : 1 }}>
              {busy ? "Avvio…" : "Avvia"}
            </button>
            {evento && (
              <button onClick={() => setMostraForm(false)} style={S.btn}>Annulla</button>
            )}
          </div>
        </div>
      )}

      {adesioni.length > 0 && (
        <div style={{ ...S.card, padding: 14 }}>
          <p style={{ fontSize: 12, ...S.sub, marginBottom: 10 }}>Chi ha risposto:</p>
          <div style={{ display: "grid", gap: 10 }}>
            {adesioni.map((a) => (
              <div key={a.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                gap: 10, paddingBottom: 10, borderBottom: "1px solid var(--border)",
              }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600 }}>
                    Camera {a.room}
                    {!a.partecipa && <span style={{ ...S.sub, fontWeight: 400 }}> — non partecipa</span>}
                  </p>
                  {a.partecipa && (
                    <p style={{ fontSize: 12, ...S.sub }}>
                      Menu: {a.menu === "vegano" ? "Vegano" : "Classico"}
                      {a.pagamento_confermato
                        ? " · pagamento confermato"
                        : a.pagamento_dichiarato
                          ? " · ha dichiarato di aver pagato"
                          : " · non ha ancora pagato"}
                    </p>
                  )}
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
            ))}
          </div>
        </div>
      )}
    </>
  );
}
