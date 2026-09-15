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

type Tipo = "grande" | "piccolo";
type Ancora = { ancora_data: string | null; ancora_tipo: Tipo | null };

/**
 * "YYYY-MM-DD" del prossimo martedì da oggi (oggi compreso, se oggi è già
 * martedì) — il valore di partenza più utile per il form: è quasi sempre il
 * martedì che si sta per configurare, prima o dopo la finestra 05:00-14:00.
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
 */
function alternanza(dataISO: string, tipo: Tipo, quanti: number): { data: string; tipo: Tipo }[] {
  const base = new Date(`${dataISO}T00:00:00Z`);
  const out: { data: string; tipo: Tipo }[] = [];
  for (let i = 0; i < quanti; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i * 7);
    const t: Tipo = i % 2 === 0 ? tipo : (tipo === "grande" ? "piccolo" : "grande");
    out.push({ data: d.toISOString().slice(0, 10), tipo: t });
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

  useEffect(() => {
    call<Ancora>("cambioBiancheriaGet")
      .then((r) => {
        setSalvata(r);
        // Riparte da cosa è salvato, non dal valore di comodo: se un'ancora
        // esiste già, il form la mostra invece di suggerire di spostarla.
        if (r.ancora_data && r.ancora_tipo) { setData(r.ancora_data); setTipo(r.ancora_tipo); }
      })
      .catch((e: any) => setMsg(e.message));
  }, []);

  const dataValida = eMartedi(data);
  const anteprima = useMemo(() => dataValida ? alternanza(data, tipo, 6) : [], [data, tipo, dataValida]);

  async function salva() {
    if (!dataValida || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await call<{ ancora_data: string; ancora_tipo: Tipo }>("cambioBiancheriaSet", {
        ancora_data: data, ancora_tipo: tipo,
      });
      setSalvata({ ancora_data: r.ancora_data, ancora_tipo: r.ancora_tipo });
      setMsg("Salvato.");
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
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
        <div style={{ ...S.card, padding: 14 }}>
          <p style={{ fontSize: 12, ...S.sub, marginBottom: 8 }}>
            Anteprima di cosa verrebbe salvato (le prossime settimane):
          </p>
          <div style={{ display: "grid", gap: 4 }}>
            {anteprima.map((r) => (
              <div key={r.data} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={S.sub}>{fmtData(r.data)}</span>
                <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{r.tipo}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
