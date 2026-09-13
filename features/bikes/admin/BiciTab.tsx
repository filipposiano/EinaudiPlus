import { useCallback, useEffect, useState } from "react";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";
import { PIANI, pianoDi, nomePiano, colorePiano } from "../../../piani";

// ─── Bici ────────────────────────────────────────────────────────────────────
//
// Non ha niente a che fare con lavanderia o sale: e' la stessa domanda che
// oggi si segna a mano su un foglio all'ingresso — "questa camera ha una
// bici?" — vista da chi sta alla reception. Ogni riga la dichiara il
// residente stesso, dalla sua sezione "Bici".

type Camera = { room: string; creato_da: "residente" | "sistemista" };
type BiciDati = { totale: number; camere: Camera[] };

const IconaBici = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="5.5" cy="17.5" r="3.5" />
    <circle cx="18.5" cy="17.5" r="3.5" />
    <path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="currentColor" stroke="none" />
    <path d="M12 17.5V14l-3-3 4-3 2 3h3" />
  </svg>
);

// Stessa famiglia grafica di IconaBici/IconaArchivia: una sagoma minima, non
// un'icona di libreria — questo file resta senza lucide-react per non
// appesantire il bundle lazy con due glifi soli.
const IconaReception = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.5 3.5-8 8-8s8 3.5 8 8" />
  </svg>
);

// Una camera, come pastiglia colorata del suo piano. Cliccabile solo dal
// sistemista — vedi il commento su SOLO_SISTEMISTA in api/admin/data.js:
// togliere una dichiarazione e' un "cancella" come deletePushSub e
// deleteTelegramSub, riservati allo stesso ruolo. L'FDO la vede ma non la
// tocca, come per "Cancella tutte" piu' sotto.
function CameraChip({ room, creatoDa, colore, sistemista, onClick }: {
  room: string; creatoDa: Camera["creato_da"]; colore: string; sistemista: boolean; onClick: () => void;
}) {
  const stile = {
    position: "relative" as const,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "9px 10px", borderRadius: 12, fontSize: 13, fontWeight: 700, fontFamily: "monospace",
    background: `color-mix(in srgb, ${colore} 12%, var(--card))`,
    border: `1px solid color-mix(in srgb, ${colore} 32%, var(--border))`,
    color: "var(--foreground)",
  } as const;
  const icona = <span style={{ color: colore, display: "flex", flexShrink: 0 }}><IconaBici /></span>;
  // Segno persistente, non un messaggio che si legge una volta sola e sparisce:
  // la prossima persona di turno alla reception deve poter vedere "questa
  // l'ho assegnata io" tornando su questa stessa lista domani.
  const distintivo = creatoDa === "sistemista" && (
    <span title="Assegnata dalla reception, non dal residente" style={{
      position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: 99,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: colore, color: "#fff", border: "2px solid var(--card)",
    }}>
      <IconaReception />
    </span>
  );

  return sistemista ? (
    <button onClick={onClick} style={{ ...stile, cursor: "pointer" }}>{icona}{room}{distintivo}</button>
  ) : (
    <div style={stile}>{icona}{room}{distintivo}</div>
  );
}

export function Bici({ sistemista }: { sistemista: boolean }) {
  const [dati, setDati] = useState<BiciDati | null>(null);
  const [busy, setBusy] = useState(false);
  const [chiesto, setChiesto] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // La camera per cui e' apparso il popup "Elimina" (solo sistemista).
  const [daEliminare, setDaEliminare] = useState<string | null>(null);
  const [nuovaCamera, setNuovaCamera] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try { setDati(await call<BiciDati>("biciList")); }
    catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Solo il sistemista arriva a vedere questo pulsante (vedi AdminScreens),
  // ma il controllo vero e' server-side: SOLO_SISTEMISTA in
  // api/admin/data.js rifiuterebbe comunque la chiamata a chi non lo e'.
  async function reset() {
    setBusy(true); setMsg(null);
    try {
      const r = await call<{ cancellate: number }>("biciPurge");
      setMsg(`Fatto — camere cancellate: ${r.cancellate}.`);
      setChiesto(false);
      load();
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function eliminaCamera() {
    if (!daEliminare) return;
    setBusy(true); setMsg(null);
    try {
      await call("biciDeleteRoom", { room: daEliminare });
      setDaEliminare(null);
      load();
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  // Solo il sistemista arriva a vedere questo campo (stesso motivo di
  // reset()): assegnare una bici e' l'altra faccia di toglierla, riservata
  // allo stesso ruolo. bike_admin_set e' idempotente come bike_set (dichiararla
  // due volte non duplica niente) ma marca la riga come assegnata dalla
  // reception e avvisa il residente — solo se la camera non l'aveva gia'.
  async function assegnaCamera() {
    const room = nuovaCamera.trim();
    if (!room) return;
    setBusy(true); setMsg(null);
    try {
      const r = await call<{ inserted: boolean }>("biciAddRoom", { room });
      setMsg(r.inserted
        ? `Fatto — camera ${room} segnata. Se ha le notifiche attive, il residente riceverà un avviso.`
        : `La camera ${room} aveva già una bici registrata: non è cambiato nulla.`);
      setNuovaCamera("");
      load();
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16, maxWidth: "70ch" }}>
        Le camere che hanno dichiarato di avere una bici, dalla loro sezione "Bici".
        {sistemista && " Tocca una camera per togliere la sua dichiarazione."}
      </p>

      <div style={{
        ...S.card, padding: 14, marginBottom: 16, display: "flex", alignItems: "center", gap: 14,
        background: "color-mix(in srgb, var(--primary) 6%, var(--card))",
        borderColor: "color-mix(in srgb, var(--primary) 25%, var(--border))",
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 14, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "color-mix(in srgb, var(--primary) 16%, transparent)", color: "var(--primary)",
        }}>
          <span style={{ transform: "scale(1.5)" }}><IconaBici /></span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--foreground)" }}>
            {dati ? dati.totale : "—"}
          </p>
          <p style={{ fontSize: 12, color: "var(--foreground)" }}>
            {dati?.totale === 1 ? "camera con una bici" : "camere con una bici"}
          </p>
        </div>
      </div>

      {msg && <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      {/* Come per "Cancella tutte le bici" piu' sotto: solo il sistemista la
          vede, l'FDO vede la lista ma non la tocca. */}
      {sistemista && (
        <div style={{ ...S.card, padding: 14, marginBottom: 16 }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Assegna una bici a una camera</p>
          <p style={{ fontSize: 12, ...S.sub, marginBottom: 10 }}>
            Per chi non usa l'app, o per farla dichiarare dalla reception invece che dal residente stesso.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...S.input, flex: 1 }} placeholder="Numero camera (es. 214 o 21-b)"
              value={nuovaCamera} disabled={busy}
              onChange={(e) => setNuovaCamera(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") assegnaCamera(); }}
            />
            <button
              style={{ ...S.btn, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" }}
              disabled={busy || !nuovaCamera.trim()} onClick={assegnaCamera}
            >
              Assegna
            </button>
          </div>
        </div>
      )}

      {dati && dati.camere.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 16 }}>
          {/* Un gruppo per piano, nell'ordine di PIANI — non alfabetico, cosi'
              "Manica" (un edificio a se') resta separata dai piani veri e
              propri, che a loro volta salgono dal primo al quarto. I piani
              senza nessuna camera non compaiono: un elenco di intestazioni
              vuote non aiuta chi deve solo vedere dove sono le bici. */}
          {PIANI.map((p) => {
            const camere = dati.camere.filter((c) => pianoDi(c.room) === p);
            if (camere.length === 0) return null;
            const colore = colorePiano(p);
            return (
              <div key={p}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 99, background: colore, flexShrink: 0 }} />
                  <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", ...S.sub }}>
                    {nomePiano(p)} · {camere.length}
                  </p>
                </div>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))" }}>
                  {camere.map((c) => (
                    <CameraChip key={c.room} room={c.room} creatoDa={c.creato_da} colore={colore} sistemista={sistemista}
                      onClick={() => setDaEliminare(c.room)} />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Rete di sicurezza: una camera con un formato che non torna in
              nessun piano (non dovrebbe succedere, bike_set valida il
              formato lato server) non sparisce silenziosamente. */}
          {(() => {
            const fuoriSchema = dati.camere.filter((c) => pianoDi(c.room) === null);
            if (fuoriSchema.length === 0) return null;
            return (
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", ...S.sub, marginBottom: 7 }}>
                  Altre · {fuoriSchema.length}
                </p>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))" }}>
                  {fuoriSchema.map((c) => (
                    <CameraChip key={c.room} room={c.room} creatoDa={c.creato_da} colore="var(--foreground)" sistemista={sistemista}
                      onClick={() => setDaEliminare(c.room)} />
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <p style={{ fontSize: 13, ...S.sub, marginBottom: 16 }}>
          {dati ? "Nessuna camera ha dichiarato una bici." : "Caricamento…"}
        </p>
      )}

      {/* Il reset annuale: solo il sistemista lo vede. Una conferma sola,
          non la parola da scrivere che chiede "Azzera tutto" in
          Manutenzione — qui non si perdono prenotazioni ne' account, solo
          dichiarazioni che ogni residente puo' rifare in un tocco. */}
      {sistemista && (
        <div style={{ ...S.card, padding: 14, borderColor: chiesto ? "var(--destructive)" : "var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600 }}>Cancella tutte le bici</p>
              <p style={{ fontSize: 12, ...S.sub }}>
                Per il reset annuale, a inizio anno: ogni residente dovrà dichiararla di nuovo.
              </p>
            </div>
            {!chiesto && (
              <button style={S.danger} disabled={busy}
                onClick={() => { setChiesto(true); setMsg(null); }}>
                Esegui
              </button>
            )}
          </div>

          {chiesto && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <p style={{ fontSize: 13, marginBottom: 10 }}>
                <strong>L'operazione non è annullabile.</strong> Confermi?
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={S.danger} disabled={busy} onClick={reset}>
                  {busy ? "In corso…" : "Sì, cancella tutte"}
                </button>
                <button style={S.btn} disabled={busy} onClick={() => setChiesto(false)}>
                  Annulla
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Popup di eliminazione singola: un overlay centrato, non una scheda
          che si espande sul posto come "Cancella tutte" — qui il tocco parte
          da una pastiglia dentro una griglia fitta, e la conferma deve
          comparire dove l'occhio sta gia' guardando, non scorrere per
          trovarla. */}
      {daEliminare && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 60, display: "flex",
          alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", padding: 20,
        }} onClick={() => !busy && setDaEliminare(null)}>
          <div style={{ ...S.card, padding: 20, maxWidth: 320, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Camera {daEliminare}</p>
            <p style={{ fontSize: 13, ...S.sub, marginBottom: 16 }}>
              Togliere la dichiarazione di questa camera? Potrà rifarla in qualsiasi momento dalla sua sezione "Bici".
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={S.danger} disabled={busy} onClick={eliminaCamera}>
                {busy ? "In corso…" : "Elimina"}
              </button>
              <button style={S.btn} disabled={busy} onClick={() => setDaEliminare(null)}>
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
