import { useCallback, useEffect, useState } from "react";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";
import type { Role } from "../../admin-shared/types";

// Un account amministrativo. La password non compare mai qui: il pannello la
// invia una volta, in creazione o in reset, e da li' in poi esiste solo come
// hash nel database.
type Account = {
  id: number; username: string; ruolo: Role; attivo: boolean;
  created_at: string; password_at: string; deve_cambiare_password: boolean;
};

// ─── Account amministrativi ─────────────────────────────────────────────────
//
// Prima fdo, staff e sistemista erano tre righe fisse nelle variabili
// d'ambiente di Vercel: un account per ruolo, e cambiarne la password voleva
// dire chiedere a chi ha accesso a Vercel di rigenerare l'hash e ridistribuire.
// Da qui il sistemista crea, disattiva e reimposta gli account da solo.

/** Lettere maiuscole/minuscole/cifre/simboli leggibili: niente 0/O/1/l/I. */
function generaPassword(lunghezza = 16) {
  const alfabeto = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#%&*";
  const casuali = crypto.getRandomValues(new Uint32Array(lunghezza));
  return Array.from(casuali, (n) => alfabeto[n % alfabeto.length]).join("");
}

const RUOLI_CREABILI: { value: Role; label: string }[] = [
  { value: "fdo", label: "FDO (portineria)" },
  { value: "staff", label: "Staff" },
  { value: "sistemista", label: "Sistemista" },
  { value: "delegato", label: "Delegato (Grigliata)" },
];

const etichettaData = (iso: string) =>
  new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });

export function Accounts({ me }: { me: string | null }) {
  const [items, setItems] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ruolo, setRuolo] = useState<Role>("staff");
  const [mostraPassword, setMostraPassword] = useState(false);

  // L'account per cui si sta scrivendo una nuova password, se ce n'e' uno.
  const [reset, setReset] = useState<{ id: number; password: string } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try { setItems((await call("accountList")).items); }
    catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function crea() {
    if (!username.trim()) { setMsg("Indica un nome utente."); return; }
    if (password.length < 8) { setMsg("La password deve avere almeno 8 caratteri."); return; }
    setBusy(true); setMsg(null);
    try {
      await call("accountCreate", { username: username.trim(), password, ruolo });
      setMsg(`Account "${username.trim()}" creato.`);
      setUsername(""); setPassword(""); setMostraPassword(false);
      load();
    } catch (e: any) {
      setMsg(e.message === "nome utente gia' in uso" ? "Quel nome utente esiste gia'." : e.message);
    } finally { setBusy(false); }
  }

  async function confermaReset() {
    if (!reset || reset.password.length < 8) { setMsg("La password deve avere almeno 8 caratteri."); return; }
    setBusy(true); setMsg(null);
    try {
      await call("accountSetPassword", { id: reset.id, password: reset.password });
      setMsg("Password reimpostata.");
      setReset(null);
      load();
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function toggle(a: Account) {
    try { await call("accountSetActive", { id: a.id, attivo: !a.attivo }); load(); }
    catch (e: any) { setMsg(e.message); }
  }

  async function elimina(a: Account) {
    if (!confirm(`Eliminare l'account "${a.username}"? Resta traccia nel registro azioni di cio' che ha gia' fatto.`)) return;
    setBusy(true);
    try { await call("accountDelete", { id: a.id }); load(); }
    catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16 }}>
        Fdo, staff e sistemista non sono piu' tre password fisse su Vercel: qui puoi
        creare un account per persona, disattivarlo quando non serve piu' e
        reimpostarne la password senza toccare la configurazione del server.
      </p>

      {msg && <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Nuovo account</h2>
        <div className="adm-form">
          <input style={S.input} placeholder="Nome utente" value={username}
                 maxLength={24} onChange={(e) => setUsername(e.target.value)} />
          <select style={S.input} value={ruolo} onChange={(e) => setRuolo(e.target.value as Role)}>
            {RUOLI_CREABILI.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <input style={S.input} type={mostraPassword ? "text" : "password"} placeholder="Password (min. 8 caratteri)"
                 value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" style={S.btn} onClick={() => { setPassword(generaPassword()); setMostraPassword(true); }}>
            Genera
          </button>
          <button style={{ ...S.btn, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" }}
                  disabled={busy} onClick={crea}>Crea account</button>
        </div>
        {mostraPassword && password && (
          <p style={{ fontSize: 12, ...S.sub, marginTop: 10 }}>
            Copiala ora: non verra' piu' mostrata dopo la creazione. <strong style={{ color: "var(--foreground)" }}>{password}</strong>
          </p>
        )}
      </div>

      <div style={{ ...S.card, padding: 18 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Account ({items.length})</h2>
        {items.length === 0 && <p style={{ fontSize: 13, ...S.sub }}>Nessun account creato dal pannello.</p>}
        <div style={{ display: "grid", gap: 6 }}>
          {items.map((a) => (
            <div key={a.id}>
              <div className="adm-rule" style={{ opacity: a.attivo ? 1 : 0.5 }}>
                {/* Larghezza fissa: "SISTEMISTA" e "FDO" hanno lunghezze
                    molto diverse, e senza un minimo comune ogni riga faceva
                    iniziare il nome utente a un punto diverso — la colonna
                    non era una colonna. */}
                <span style={{ fontSize: 11, fontWeight: 700, ...S.sub, textTransform: "uppercase", minWidth: "9ch", flexShrink: 0 }}>
                  {a.ruolo}
                </span>
                <span className="adm-rule__what">
                  {a.username}{a.username === me && <span style={{ ...S.sub }}> (tu)</span>}
                  {/* Chi non ha ancora fatto il primo accesso non ha ancora
                      scelto una password sua: sta ancora usando quella data
                      dal sistemista alla creazione (o all'ultimo reset). */}
                  {a.deve_cambiare_password && (
                    <span style={{
                      marginLeft: 8, fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 99,
                      background: "color-mix(in srgb, var(--destructive) 12%, transparent)",
                      color: "var(--destructive-text)",
                    }}>In attesa del primo accesso</span>
                  )}
                  <span style={{ display: "block", fontSize: 12, ...S.sub }}>
                    creato il {etichettaData(a.created_at)} · password aggiornata il {etichettaData(a.password_at)}
                  </span>
                </span>
                <span className="adm-rule__act">
                  <button style={S.btn} disabled={busy}
                          onClick={() => setReset(reset?.id === a.id ? null : { id: a.id, password: "" })}>
                    Reimposta password
                  </button>
                  {/* Disattivare o eliminare il proprio account da qui non blocca fuori
                      nessuno (le tre variabili d'ambiente restano una via d'accesso),
                      ma resta un modo facile di spararsi in un piede per sbaglio. */}
                  <button style={S.btn} disabled={busy || a.username === me} onClick={() => toggle(a)}>
                    {a.attivo ? "Disattiva" : "Riattiva"}
                  </button>
                  <button style={S.danger} disabled={busy || a.username === me} onClick={() => elimina(a)}>Elimina</button>
                </span>
              </div>
              {reset?.id === a.id && (
                <div className="adm-form" style={{ marginTop: 6 }}>
                  <input style={S.input} type="text" placeholder="Nuova password (min. 8 caratteri)"
                         value={reset.password} onChange={(e) => setReset({ id: a.id, password: e.target.value })} />
                  <button type="button" style={S.btn} onClick={() => setReset({ id: a.id, password: generaPassword() })}>
                    Genera
                  </button>
                  <button style={{ ...S.btn, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" }}
                          disabled={busy} onClick={confermaReset}>Conferma</button>
                  <button style={S.btn} disabled={busy} onClick={() => setReset(null)}>Annulla</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
