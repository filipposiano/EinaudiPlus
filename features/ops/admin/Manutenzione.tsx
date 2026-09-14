import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";

// ─── Manutenzione (sistemista) ───────────────────────────────────────────────

// Le quattro sale, con l'identificatore che la funzione SQL si aspetta.
// "lavanderia" non e' una sala, ma da qui si guarda e si svuota come le altre.
type SalaId = "lavanderia" | "cinema" | "musica" | "polivalente";

const SALE: [SalaId, string][] = [
  ["lavanderia",  "Lavanderia"],
  ["cinema",      "Sala cinema"],
  ["musica",      "Sala musica"],
  ["polivalente", "Sala polivalente"],
];

// Quante prenotazioni esistono ADESSO, in totale e in questa settimana.
// Per la polivalente il totale conta le regole e la settimana le occorrenze:
// una regola sola ("ogni martedi'") e' un incontro per chi la scrive e sette
// righe in agenda. Vedi migrations/019.
type Conteggi = {
  settimana_dal: string;
  totale: Record<SalaId, number>;
  settimana: Record<SalaId, number>;
};

const AMBITI: [string, string, string][] = [
  ["settimana",    "Svuota la settimana corrente",  "Toglie le prenotazioni di questa settimana — lavanderia, cinema, musica e polivalente. Lo storico resta."],
  ["prenotazioni", "Tutte le prenotazioni",          "Cancella anche lo storico delle settimane passate."],
  ["segnalazioni", "Tutte le segnalazioni",          "Svuota la lista dei feedback, gestiti e non."],
  ["notifiche",    "Tutte le iscrizioni",            "Push e Telegram. Chi li aveva attivi dovrà riattivarli."],
  ["ricorrenti",   "Tutte le regole ricorrenti",     "Le prenotazioni già create restano."],
  ["tutto",        "Azzera tutto",                   "Tutto quanto sopra, e rimette in servizio le macchine. La configurazione e il registro delle azioni restano."],
];

// Gli ambiti che sanno guardare una sala sola. Gli altri non ne hanno una:
// segnalazioni, iscrizioni e regole ricorrenti non appartengono a una stanza,
// e la funzione SQL rifiuta la richiesta se qualcuno ci prova lo stesso.
const PER_SALA = new Set(["settimana", "prenotazioni"]);

const totaleDi = (c: Record<SalaId, number> | undefined) =>
  c ? SALE.reduce((n, [id]) => n + (c[id] || 0), 0) : 0;

/** Il contatore, sempre in cima alla scheda.
 *
 *  Prima diceva solo quante righe erano state cancellate, e quel numero non
 *  bastava: "sale: 0" si legge uguale se non c'era niente da togliere e se la
 *  pulizia stava guardando nella tabella sbagliata — che e' esattamente cosa
 *  succedeva alla polivalente. Un conteggio di cosa e' rimasto, letto dal
 *  database, e' l'unica risposta che non si puo' fraintendere: dopo uno
 *  svuotamento va a zero da solo. */
function Contatore({ dati, scaduto, onPulisci }: {
  dati: Conteggi | null; scaduto: boolean; onPulisci: (id: SalaId) => void;
}) {
  const tot = totaleDi(dati?.totale);
  const set = totaleDi(dati?.settimana);
  const righe: [SalaId | null, string, number, number][] =
    ([[null, "Tutte", tot, set]] as [SalaId | null, string, number, number][]).concat(
      SALE.map(([id, nome]) => [id, nome, dati?.totale?.[id] ?? 0, dati?.settimana?.[id] ?? 0])
    );

  return (
    <div style={{ ...S.card, padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", ...S.sub }}>
          Prenotazioni adesso
        </p>
        {scaduto && <span style={{ fontSize: 11, color: "var(--destructive-text)" }}>contatore non aggiornato</span>}
      </div>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))" }}>
        {righe.map(([id, nome, n, nSett], i) => (
          <div key={nome} style={{
            position: "relative", padding: "10px 12px", borderRadius: 12,
            background: i === 0 ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "var(--secondary)",
          }}>
            {/* Svuotare una sala sola da qui salta dritto alla conferma della
                scheda "Svuota la settimana corrente" qui sotto, gia' con
                questa sala scelta — quella scheda chiede gia' conferma, non
                serve chiederla due volte. "Tutte" non ha il cestino: e' la
                stessa cosa dell'ambito "Azzera tutto", che ha gia' il suo. */}
            {id && (
              <button onClick={() => onPulisci(id)} title={`Svuota la settimana di ${nome}`}
                style={{
                  position: "absolute", top: 8, right: 8, display: "flex",
                  alignItems: "center", justifyContent: "center", width: 22, height: 22,
                  borderRadius: 7, border: "none", cursor: "pointer",
                  background: "transparent", color: "var(--destructive-text)", opacity: 0.6,
                }}>
                <Trash2 size={13} />
              </button>
            )}
            <p style={{ fontSize: 11, fontWeight: 600, ...S.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: id ? 20 : 0 }}>
              {nome}
            </p>
            {/* tabular-nums: senza, il numero balla a ogni aggiornamento */}
            <p style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
              {dati ? n : "—"}
            </p>
            <p style={{ fontSize: 11, ...S.sub, fontVariantNumeric: "tabular-nums" }}>
              {dati ? `${nSett} questa settimana` : " "}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Manutenzione() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [chiesto, setChiesto] = useState<string | null>(null);   // ambito in attesa di conferma
  const [parola, setParola] = useState("");
  const [sala, setSala] = useState<SalaId | null>(null);         // null = tutte le sale
  const [conteggi, setConteggi] = useState<Conteggi | null>(null);
  const [scaduto, setScaduto] = useState(false);

  const aggiorna = useCallback(async () => {
    try { setConteggi(await call<Conteggi>("counts")); setScaduto(false); }
    catch { setScaduto(true); }   // il contatore non e' l'operazione: non blocca niente
  }, []);

  // Il cestino su una sala del contatore salta dritto alla conferma della
  // scheda "Svuota la settimana corrente", gia' con quella sala scelta: la
  // conferma la chiede comunque quella scheda, non serve chiederla qui.
  function pulisciSala(id: SalaId) {
    setChiesto("settimana"); setSala(id); setParola(""); setMsg(null);
  }

  // Si rilegge da solo ogni dieci secondi, cosi' resta vero anche mentre
  // qualcun altro prenota. Se la scheda e' nascosta non si chiede niente: in
  // portineria il pannello resta aperto per ore.
  useEffect(() => {
    aggiorna();
    const t = setInterval(() => { if (!document.hidden) aggiorna(); }, 10_000);
    const alRitorno = () => { if (!document.hidden) aggiorna(); };
    document.addEventListener("visibilitychange", alRitorno);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", alRitorno); };
  }, [aggiorna]);

  // La conferma sta dentro la pagina e non in window.confirm().
  //
  // confirm() è bloccato in diversi contesti — PWA installata, iframe senza
  // allow-modals — e quando lo è ritorna false senza mostrare niente: il
  // pulsante sembrava semplicemente non funzionare. "Azzera tutto" ne aveva
  // due di fila, quindi era il primo a dare quell'impressione.
  //
  // Qui invece si vede sempre cosa sta succedendo, e per l'azzeramento totale
  // si deve scrivere una parola: non basta un doppio clic distratto.
  async function esegui(scope: string, quale: SalaId | null) {
    setBusy(true); setMsg(null);
    try {
      const r = await call("purge", { scope, ...(quale ? { sala: quale } : {}) });
      const righe = Object.entries(r.cancellati || {})
        .filter(([, v]) => v !== 0 && v !== false)
        .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
        .join(" · ");
      setMsg(righe ? "Fatto — " + righe : "Fatto. Non c'era nulla da cancellare.");
      setChiesto(null); setParola(""); setSala(null);
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
      aggiorna();   // il numero che va a zero e' la prova che l'operazione e' arrivata al database
    }
  }

  return (
    <>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16 }}>
        Operazioni distruttive e non annullabili. Il registro delle azioni non viene mai
        cancellato: serve proprio a sapere chi ha svuotato cosa e quando.
      </p>

      <Contatore dati={conteggi} scaduto={scaduto} onPulisci={pulisciSala} />

      {msg && <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      <div style={{ display: "grid", gap: 10 }}>
        {AMBITI.map(([scope, label, desc]) => {
          const inAttesa = chiesto === scope;
          const totale   = scope === "tutto";
          const perSala  = PER_SALA.has(scope);
          // Per l'azzeramento totale serve scrivere la parola: un clic di
          // troppo non deve poter svuotare tutto.
          const puoi = !totale || parola.trim().toUpperCase() === "AZZERA";
          const quante = scope === "settimana" ? conteggi?.settimana : conteggi?.totale;

          return (
            <div key={scope} style={{
              ...S.card, padding: 14,
              borderColor: totale || inAttesa ? "var(--destructive)" : "var(--border)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600 }}>{label}</p>
                  <p style={{ fontSize: 12, ...S.sub }}>{desc}</p>
                </div>
                {!inAttesa && (
                  <button style={S.danger} disabled={busy}
                    onClick={() => { setChiesto(scope); setParola(""); setSala(null); setMsg(null); }}>
                    Esegui
                  </button>
                )}
              </div>

              {inAttesa && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                  {/* Una sala sola, o tutte. La scelta sta nella conferma e non
                      accanto al pulsante: e' li' che si decide cosa sparisce. */}
                  {perSala && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: 12, ...S.sub, marginBottom: 6 }}>Cosa svuotare</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {([[null, "Tutte", totaleDi(quante)] as [SalaId | null, string, number]]).concat(
                          SALE.map(([id, nome]) => [id, nome, quante?.[id] ?? 0] as [SalaId | null, string, number])
                        ).map(([id, nome, n]) => {
                          const scelta = sala === id;
                          return (
                            <button key={id ?? "tutte"} type="button" disabled={busy}
                              onClick={() => setSala(id)}
                              style={{
                                ...S.btn, fontSize: 12, padding: "6px 10px",
                                background: scelta ? "var(--primary)" : "var(--secondary)",
                                color: scelta ? "var(--primary-foreground)" : "var(--foreground)",
                                borderColor: scelta ? "transparent" : "var(--border)",
                              }}>
                              {nome}
                              <span style={{ opacity: 0.75, marginLeft: 6, fontVariantNumeric: "tabular-nums" }}>
                                {conteggi ? n : "—"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p style={{ fontSize: 13, marginBottom: 10 }}>
                    <strong>L'operazione non è annullabile.</strong>{" "}
                    {totale
                      ? "Scrivi AZZERA qui sotto per confermare."
                      : "Confermi?"}
                  </p>

                  {totale && (
                    <input
                      style={{ ...S.input, marginBottom: 10 }}
                      value={parola} autoFocus placeholder="AZZERA"
                      onChange={(e) => setParola(e.target.value)}
                    />
                  )}

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      style={{
                        ...S.danger,
                        opacity: puoi && !busy ? 1 : 0.45,
                        cursor: puoi && !busy ? "pointer" : "default",
                      }}
                      disabled={!puoi || busy}
                      onClick={() => esegui(scope, perSala ? sala : null)}>
                      {busy ? "In corso…" : totale ? "Azzera tutto" : "Sì, procedi"}
                    </button>
                    <button style={S.btn} disabled={busy}
                      onClick={() => { setChiesto(null); setParola(""); setSala(null); }}>
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
