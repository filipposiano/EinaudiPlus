import { useEffect, useMemo, useState } from "react";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";

// ─── Cambio biancheria del martedì ────────────────────────────────────────────
//
// Riservata a FDO e sistemista (non allo staff — vedi
// src/modules/linen-change/domain/policy.js): è una decisione operativa di
// portineria, come lo stato delle macchine, non un'estetica come il tema.
//
// Il cambio (grande o piccolo) si alterna da solo ogni martedì: qui non si
// sceglie "questa settimana", si sposta un'ANCORA — un martedì e il suo tipo
// — da cui ogni altro martedì, passato o futuro, si ricalcola per parità di
// settimane. La stessa azione copre sia una correzione occasionale sia la
// ripartenza dopo una chiusura del collegio: si sceglie il martedì di
// ripartenza e il suo tipo, il resto segue da lì.
//
// "Questa settimana non c'è cambio" è una cosa diversa e vive a parte: salta
// un martedì specifico SENZA disturbare l'alternanza — il martedì dopo torna
// al tipo che avrebbe avuto comunque. È il motivo per cui non è un terzo
// pulsante grande/piccolo/nessuno nel form qui sopra: mischiarlo lì avrebbe
// fatto sembrare "nessuno" un valore della sequenza, quando invece è
// un'eccezione puntuale che non la tocca.

type Tipo = "grande" | "piccolo";
type TipoOSalto = Tipo | "nessuno";
type Ancora = { ancora_data: string | null; ancora_tipo: Tipo | null; salta: string[] };

/**
 * "YYYY-MM-DD" del prossimo martedì da oggi (oggi compreso, se oggi è già
 * martedì) — il valore di partenza più utile per entrambi i form: è quasi
 * sempre il martedì di cui si sta parlando, prima o dopo la finestra
 * 05:00-14:00.
 */
function prossimoMartedi(): string {
  const d = new Date();
  const distanza = (2 - d.getDay() + 7) % 7;   // getDay(): 0=domenica..2=martedì..6=sabato
  d.setDate(d.getDate() + distanza);
  return d.toISOString().slice(0, 10);
}

function eMartedi(dataISO: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) return false;
  const d = new Date(`${dataISO}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 2;
}

/**
 * Anteprima locale, SOLO per far vedere all'admin cosa sta per salvare prima
 * che lo salvi — la stessa alternanza per parità di settimane calcolata in
 * SQL da linen_change_type_for(), duplicata qui apposta: se questa anteprima
 * avesse un difetto il peggio è un'anteprima sbagliata, non un cambio
 * biancheria sbagliato — quello lo decide sempre e solo il server.
 *
 * `salti` interviene PRIMA dell'alternanza e non la sposta, esattamente come
 * in SQL: un martedì saltato mostra "nessuno" ma non cambia cosa mostrano
 * gli altri.
 */
function alternanza(dataISO: string, tipo: Tipo, quanti: number, salti: Set<string>): { data: string; tipo: TipoOSalto }[] {
  const base = new Date(`${dataISO}T00:00:00Z`);
  const out: { data: string; tipo: TipoOSalto }[] = [];
  for (let i = 0; i < quanti; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i * 7);
    const iso = d.toISOString().slice(0, 10);
    const t: TipoOSalto = salti.has(iso) ? "nessuno" : (i % 2 === 0 ? tipo : (tipo === "grande" ? "piccolo" : "grande"));
    out.push({ data: iso, tipo: t });
  }
  return out;
}

function fmtData(dataISO: string): string {
  const d = new Date(`${dataISO}T00:00:00Z`);
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function CambioBiancheria() {
  const [salvata, setSalvata] = useState<Ancora | null>(null);
  const [data, setData] = useState<string>(prossimoMartedi());
  const [tipo, setTipo] = useState<Tipo>("grande");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Sezione "salta un martedì": stato a parte, così segnare o annullare un
  // salto non sporca il messaggio di esito del form dell'ancora qui sopra.
  const [dataSalto, setDataSalto] = useState<string>(prossimoMartedi());
  const [busySalto, setBusySalto] = useState(false);
  const [msgSalto, setMsgSalto] = useState<string | null>(null);

  const carica = () =>
    call<Ancora>("cambioBiancheriaGet")
      .then((r) => {
        setSalvata(r);
        // Riparte da cosa è salvato, non dal valore di comodo: se un'ancora
        // esiste già, il form la mostra invece di suggerire di spostarla.
        if (r.ancora_data && r.ancora_tipo) { setData(r.ancora_data); setTipo(r.ancora_tipo); }
      })
      .catch((e: any) => setMsg(e.message));

  useEffect(() => { carica(); }, []);

  const salti = useMemo(() => new Set(salvata?.salta ?? []), [salvata]);
  const dataValida = eMartedi(data);
  const anteprima = useMemo(() => dataValida ? alternanza(data, tipo, 6, salti) : [], [data, tipo, dataValida, salti]);

  const dataSaltoValida = eMartedi(dataSalto);
  const giaSaltato = salti.has(dataSalto);

  async function salva() {
    if (!dataValida || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await call<{ ancora_data: string; ancora_tipo: Tipo }>("cambioBiancheriaSet", {
        ancora_data: data, ancora_tipo: tipo,
      });
      setSalvata((prev) => ({ ancora_data: r.ancora_data, ancora_tipo: r.ancora_tipo, salta: prev?.salta ?? [] }));
      setMsg("Salvato.");
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  // La data la riceve come parametro, non la legge dallo stato `dataSalto`:
  // il pulsante "Annulla" di ogni riga della lista deve colpire la SUA data,
  // non quella (eventualmente diversa) rimasta nel campo del form sopra.
  async function impostaSalto(dataMartedi: string, salta: boolean) {
    if (!eMartedi(dataMartedi) || busySalto) return;
    setBusySalto(true); setMsgSalto(null);
    try {
      await call("cambioBiancheriaSkip", { data: dataMartedi, salta });
      // Si rilegge dal server invece di aggiornare la lista a mano: il campo
      // 'salta' che linen_change_admin_get() restituisce filtra già le date
      // troppo vecchie, e ripetere qui quella regola l'avrebbe duplicata.
      await carica();
      setMsgSalto(salta ? "Segnato: quel martedì non avrà il cambio." : "Annullato: quel martedì torna alla sequenza normale.");
    } catch (e: any) {
      setMsgSalto("Non è riuscito: " + e.message);
    } finally {
      setBusySalto(false);
    }
  }

  return (
    <>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16, maxWidth: "70ch" }}>
        Il martedì, dalle 5:00 alle 14:00, la Dashboard dei residenti mostra un
        avviso con il tipo di cambio biancheria. Si alterna da solo ogni
        settimana: qui non si sceglie "questa settimana", si sposta il
        martedì da cui ricominciare a contare — serve solo quando la sequenza
        va corretta o riparte dopo una chiusura del collegio.
      </p>

      {salvata && (
        <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>
          {salvata.ancora_data && salvata.ancora_tipo ? (
            <>Configurazione attuale: dal <b>{fmtData(salvata.ancora_data)}</b> (martedì)
               è il cambio <b>{salvata.ancora_tipo.toUpperCase()}</b>, e da lì si alterna.</>
          ) : (
            <>Non ancora configurato: finché non si salva qui sotto, la
               Dashboard dei residenti non mostra alcun avviso il martedì.</>
          )}
        </div>
      )}

      {msg && <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>
            Martedì da cui ricominciare
          </label>
          <input style={S.input} type="date" value={data} onChange={(e) => setData(e.target.value)} />
          {!dataValida && (
            <p style={{ fontSize: 12, marginTop: 4, color: "var(--destructive-text)" }}>
              Dev'essere un martedì.
            </p>
          )}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {(["grande", "piccolo"] as Tipo[]).map((id) => {
            const scelto = tipo === id;
            return (
              <button key={id} onClick={() => setTipo(id)} disabled={busy}
                style={{
                  ...S.card, padding: 14, textAlign: "left", cursor: busy ? "default" : "pointer",
                  display: "flex", alignItems: "center", gap: 12,
                  borderColor: scelto ? "var(--primary)" : "var(--border)",
                  background: scelto ? "color-mix(in srgb, var(--primary) 8%, var(--card))" : "var(--card)",
                }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 99, flexShrink: 0,
                  border: `2px solid ${scelto ? "var(--primary)" : "var(--border)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {scelto && <div style={{ width: 10, height: 10, borderRadius: 99, background: "var(--primary)" }} />}
                </div>
                <p style={{ fontSize: 14, fontWeight: 600, textTransform: "capitalize" }}>{id}</p>
              </button>
            );
          })}
        </div>

        <button onClick={salva} disabled={!dataValida || busy} style={{ ...S.btn, opacity: !dataValida || busy ? 0.5 : 1 }}>
          {busy ? "Salvo…" : "Salva"}
        </button>
      </div>

      {anteprima.length > 0 && (
        <div style={{ ...S.card, padding: 14, marginBottom: 16 }}>
          <p style={{ fontSize: 12, ...S.sub, marginBottom: 8 }}>
            Anteprima di cosa verrebbe salvato (le prossime settimane):
          </p>
          <div style={{ display: "grid", gap: 4 }}>
            {anteprima.map((r) => (
              <div key={r.data} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={S.sub}>{fmtData(r.data)}</span>
                <span style={{ fontWeight: 600, textTransform: "capitalize", color: r.tipo === "nessuno" ? "var(--gray-accessible-text)" : "var(--foreground)" }}>
                  {r.tipo === "nessuno" ? "Nessun cambio" : r.tipo}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Salta un martedì ────────────────────────────────────────────── */}
      <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Questa settimana non c'è cambio</p>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 12, maxWidth: "70ch" }}>
        Salta un martedì specifico (es. per una settimana di chiusura) senza
        toccare la sequenza sopra: il martedì dopo torna comunque al tipo che
        avrebbe avuto.
      </p>

      {msgSalto && <div style={{ ...S.card, padding: 12, marginBottom: 12, fontSize: 13 }}>{msgSalto}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 12, ...S.sub, display: "block", marginBottom: 4 }}>Martedì</label>
          <input style={S.input} type="date" value={dataSalto} onChange={(e) => setDataSalto(e.target.value)} />
          {!dataSaltoValida && (
            <p style={{ fontSize: 12, marginTop: 4, color: "var(--destructive-text)" }}>Dev'essere un martedì.</p>
          )}
        </div>
        <button onClick={() => impostaSalto(dataSalto, !giaSaltato)} disabled={!dataSaltoValida || busySalto}
          style={{ ...S.btn, opacity: !dataSaltoValida || busySalto ? 0.5 : 1 }}>
          {busySalto ? "Attendo…" : giaSaltato ? "Annulla il salto" : "Salta questo martedì"}
        </button>
      </div>

      {salvata && salvata.salta.length > 0 && (
        <div style={{ ...S.card, padding: 14 }}>
          <p style={{ fontSize: 12, ...S.sub, marginBottom: 8 }}>Martedì attualmente saltati:</p>
          <div style={{ display: "grid", gap: 6 }}>
            {salvata.salta.map((d) => (
              <div key={d} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                <span>{fmtData(d)}</span>
                <button onClick={() => impostaSalto(d, false)} disabled={busySalto}
                  style={{ ...S.danger, opacity: busySalto ? 0.5 : 1 }}>
                  Annulla
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
