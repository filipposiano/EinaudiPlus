import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";

// ─── Sale (chiusura per deposito pacchi) ───────────────────────────────────────
//
// Riservata a FDO e sistemista (non allo staff — vedi
// src/modules/common-spaces/domain/policy.js): stesso livello dello stato
// guasto/funzionante delle macchine, non un'estetica.
//
// Solo Sala Musica ha qui un pulsante: è l'unica per cui questo blocco è
// stato chiesto. La Sala Cinema non compare — non perché il meccanismo non
// valga anche per lei (space_admin_set_chiuso() accetta qualunque sala),
// ma perché aggiungere un pulsante che non serve a nessuno oggi avrebbe
// solo fatto sembrare che la Direzione debba decidere qualcosa anche lì.
//
// Il blocco vero non è questo pulsante: è book_space() lato SQL, che
// rifiuta qualunque prenotazione nuova mentre la sala è chiusa, chiamata
// pubblica o della Direzione che sia. Questo pannello si limita a girare
// l'interruttore.

type Sala = { slug: string; name: string; chiuso: boolean };
type Overview = { items: unknown[]; sale: Sala[] };

export function Sale() {
  const [sale, setSale] = useState<Sala[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const carica = () =>
    call<Overview>("spaces")
      .then((r) => setSale(r.sale))
      .catch((e: any) => setMsg(e.message));

  useEffect(() => { carica(); }, []);

  async function toggle(slug: string, chiuso: boolean) {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await call("spaceSetChiuso", { space: slug, chiuso });
      await carica();
      setMsg(chiuso ? "Sala chiusa: nessuno può più prenotarla finché non la riapri." : "Sala riaperta.");
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  const musica = sale?.find((s) => s.slug === "music") ?? null;

  return (
    <>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16, maxWidth: "70ch" }}>
        Chiudi la Sala Musica per il deposito dei pacchi (o un altro motivo
        operativo): finché è chiusa, nessuno può prenotarla — nemmeno la
        Direzione — ma le prenotazioni già fatte restano visibili. I
        residenti vedono un avviso al posto del modulo di prenotazione.
      </p>

      {msg && <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      {musica && (
        <div style={{
          ...S.card, padding: 16, display: "flex", alignItems: "center", gap: 14,
          borderColor: musica.chiuso ? "var(--destructive-text)" : "var(--border)",
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: musica.chiuso ? "color-mix(in srgb, var(--destructive) 15%, transparent)" : "var(--secondary)",
            color: musica.chiuso ? "var(--destructive-text)" : "var(--gray-accessible-text)",
          }}>
            <Package size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 700 }}>{musica.name}</p>
            <p style={{ fontSize: 12, ...S.sub }}>
              {musica.chiuso ? "Chiusa per il deposito dei pacchi" : "Aperta, prenotabile normalmente"}
            </p>
          </div>
          <button
            onClick={() => toggle(musica.slug, !musica.chiuso)}
            disabled={busy}
            role="switch"
            aria-checked={musica.chiuso}
            aria-label={musica.chiuso ? "Riapri la sala" : "Chiudi per il deposito dei pacchi"}
            title={musica.chiuso ? "Riapri la sala" : "Chiudi per il deposito dei pacchi"}
            style={{
              ...(musica.chiuso ? S.danger : S.btn),
              flexShrink: 0, opacity: busy ? 0.5 : 1,
            }}>
            {busy ? "…" : musica.chiuso ? "Riapri" : "Chiudi"}
          </button>
        </div>
      )}
    </>
  );
}
