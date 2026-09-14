import { useState } from "react";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";
import type { Role } from "../../admin-shared/types";
import { Login } from "./Login";

// ─── Sessione ────────────────────────────────────────────────────────────────

/** Chiude la sessione amministrativa. */
export async function adminLogout() {
  await fetch("/api/admin/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "logout" }),
  });
}

// ─── Cambio password obbligato ────────────────────────────────────────────────
//
// Un account creato (o reimpostato) dal sistemista parte con una password che
// il sistemista stesso conosce ancora: gliel'ha appena scelta lui per
// comunicargliela. Al primo accesso, prima di poter fare qualunque altra
// cosa, il titolare deve sceglierne una sua — da quel momento il sistemista
// smette di conoscerla.
export function CambiaPasswordObbligata({ onFatto }: { onFatto: () => void }) {
  const [attuale, setAttuale] = useState("");
  const [nuova, setNuova] = useState("");
  const [conferma, setConferma] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (nuova.length < 8) { setErr("La nuova password deve avere almeno 8 caratteri."); return; }
    if (nuova !== conferma) { setErr("Le due password non coincidono."); return; }
    setBusy(true); setErr(null);
    try {
      await call("accountChangeOwnPassword", { password_attuale: attuale, password_nuova: nuova });
      onFatto();
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "grid", placeItems: "center", padding: "20px 4px" }}>
      <form onSubmit={submit} style={{ ...S.card, padding: 24, width: "100%", maxWidth: 360 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Scegli una password</h2>
        <p style={{ fontSize: 13, ...S.sub, marginBottom: 18 }}>
          Prima di continuare devi impostare una password tua: quella attuale te l'ha
          data chi ha creato (o reimpostato) questo account.
        </p>

        <label style={{ fontSize: 12, ...S.sub }}>Password attuale</label>
        <input style={{ ...S.input, marginTop: 4, marginBottom: 12 }} type="password"
               value={attuale} onChange={(e) => setAttuale(e.target.value)} autoFocus />

        <label style={{ fontSize: 12, ...S.sub }}>Nuova password</label>
        <input style={{ ...S.input, marginTop: 4, marginBottom: 12 }} type="password"
               value={nuova} onChange={(e) => setNuova(e.target.value)} />

        <label style={{ fontSize: 12, ...S.sub }}>Ripeti la nuova password</label>
        <input style={{ ...S.input, marginTop: 4, marginBottom: 16 }} type="password"
               value={conferma} onChange={(e) => setConferma(e.target.value)} />

        {err && <p style={{ fontSize: 13, color: "var(--destructive-text)", marginBottom: 12 }}>{err}</p>}

        <button type="submit" disabled={busy} style={{
          ...S.btn, width: "100%", background: "var(--primary)",
          color: "var(--primary-foreground)", borderColor: "transparent",
        }}>
          {busy ? "…" : "Conferma"}
        </button>
      </form>
    </div>
  );
}

// Il login sta in una scheda a se' perche' e' l'unico punto d'ingresso: le
// sezioni amministrative vere e proprie vivono nella navigazione, accanto a
// Lavanderia / Cinema / Musica, e compaiono li' solo dopo l'accesso.
export function AdminLoginSheet({ onClose, onSession }: {
  onClose: () => void;
  // Il secondo argomento dice se il titolare deve ancora scegliere una
  // password sua: chi entra con la provvisoria deve trovarsi il cambio
  // password subito (vedi il gate in App.tsx), non scoprirlo alla prima
  // azione rifiutata dal server.
  onSession: (role: Role | null, deveCambiarePassword?: boolean) => void;
}) {
  function done() {
    fetch("/api/admin/auth")
      .then((r) => r.json())
      .then((d) => {
        onSession(d.logged ? (d.role as Role) : null, Boolean(d.deve_cambiare_password));
        onClose();
      })
      .catch(() => onSession(null));
  }

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-end",
    }} onClick={onClose}>
      <div style={{
        width: "100%", background: "var(--background)", color: "var(--foreground)",
        borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: "20px 20px 32px",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>Accesso amministratore</h2>
          <button style={S.btn} onClick={onClose}>Chiudi</button>
        </div>
        <Login onDone={done} />
      </div>
    </div>
  );
}
