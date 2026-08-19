// Pannello amministrativo — /admin
//
// Sostituisce la modifica a mano dei fogli Google. Fa solo le quattro cose per
// cui quei fogli si aprivano davvero: mettere una macchina fuori servizio,
// togliere una prenotazione, leggere le segnalazioni, sistemare le sale.
//
// Caricato in lazy da main.tsx: non pesa sul bundle dei residenti.

import { useCallback, useEffect, useState } from "react";

// ─── Tipi ────────────────────────────────────────────────────────────────────

type Machine = { code: string; kind: "washer" | "dryer"; oos: boolean; bookable: boolean };
type Laundry = {
  id: number; slug: string; name: string; rooms: string;
  quota: number; reminders: string; week_start: string;
  bookings: number; machines: Machine[];
};
type Booking = { id: number; day: number; slot: number; machine: string; room: string; by: string };
type Feedback = { id: number; room: string | null; body: string; laundry: string | null; created_at: string; handled: boolean };
type SpaceBooking = { id: number; space: string; day: number; start: number; end: number; name: string; type: string | null };

type Tab = "macchine" | "settimana" | "segnalazioni" | "sale";

// ─── Chiamate ────────────────────────────────────────────────────────────────

async function call<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/admin/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-requested-with": "admin" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (res.status === 401) throw new Error("SESSIONE_SCADUTA");
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "errore");
  return data;
}

const DAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const slotLabel = (s: number) => {
  const m = 420 + s * 75;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(m / 60) % 24)}:${p(m % 60)}`;
};
const timeLabel = (m: number) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(m / 60) % 24)}:${p(m % 60)}`;
};

// ─── Stili condivisi ─────────────────────────────────────────────────────────

const S = {
  page: { minHeight: "100vh", background: "var(--background)", color: "var(--foreground)" } as const,
  card: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16 } as const,
  sub: { color: "var(--muted-foreground)" } as const,
  btn: {
    padding: "8px 14px", borderRadius: 12, fontSize: 13, fontWeight: 600,
    border: "1px solid var(--border)", background: "var(--secondary)",
    color: "var(--foreground)", cursor: "pointer",
  } as const,
  danger: {
    padding: "6px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer",
    border: "none", background: "color-mix(in srgb, var(--destructive) 12%, transparent)",
    color: "var(--destructive)",
  } as const,
  input: {
    padding: "10px 12px", borderRadius: 12, fontSize: 14, width: "100%",
    border: "1px solid var(--border)", background: "var(--background)",
    color: "var(--foreground)",
  } as const,
};

// ─── Login ───────────────────────────────────────────────────────────────────

function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", username, password }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "credenziali non valide");
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...S.page, display: "grid", placeItems: "center", padding: 24 }}>
      <form onSubmit={submit} style={{ ...S.card, padding: 28, width: "100%", maxWidth: 360 }}>
        <p style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", ...S.sub }}>EinaudiPlus</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 20px" }}>Amministrazione</h1>

        <label style={{ fontSize: 12, ...S.sub }}>Utente</label>
        <input style={{ ...S.input, marginBottom: 12 }} value={username} autoFocus
               onChange={(e) => setUsername(e.target.value)} autoComplete="username" />

        <label style={{ fontSize: 12, ...S.sub }}>Password</label>
        <input style={{ ...S.input, marginBottom: 18 }} type="password" value={password}
               onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />

        {err && <p style={{ fontSize: 13, color: "var(--destructive)", marginBottom: 12 }}>{err}</p>}

        <button type="submit" disabled={busy}
          style={{ ...S.btn, width: "100%", padding: 12, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" }}>
          {busy ? "Accesso…" : "Entra"}
        </button>
      </form>
    </div>
  );
}

// ─── Macchine ────────────────────────────────────────────────────────────────

function Macchine({ laundries, reload }: { laundries: Laundry[]; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(l: Laundry, m: Machine) {
    setBusy(`${l.id}-${m.code}`);
    try {
      // set_machine_status risolve la lavanderia dalla camera: passiamo un
      // numero qualsiasi dell'intervallo giusto.
      await call("setMachineStatus", {
        room: l.rooms.split("–")[0], machine: m.code, oos: !m.oos,
      });
      reload();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(null); }
  }

  return (
    <>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16 }}>
        Segnare una macchina fuori servizio la mostra come guasta a tutti, ma <strong>non impedisce di prenotarla</strong>:
        chi prenota vede un avviso. Le macchine che non esistono fisicamente non sono modificabili.
      </p>

      {laundries.map((l) => (
        <div key={l.id} style={{ ...S.card, padding: 18, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>{l.name}</h2>
            <span style={{ fontSize: 12, ...S.sub }}>
              camere {l.rooms} · {l.bookings} prenotazioni questa settimana
            </span>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {l.machines.map((m) => (
              <div key={m.code} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                borderRadius: 12, border: "1px solid var(--border)",
                opacity: m.bookable ? 1 : 0.45,
                background: m.oos && m.bookable ? "color-mix(in srgb, var(--destructive) 8%, transparent)" : "transparent",
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 99,
                  background: m.oos ? "var(--destructive)" : "var(--status-free, #16a34a)",
                }} />
                <span style={{ fontFamily: "monospace", fontWeight: 700, minWidth: 44 }}>{m.code}</span>
                <span style={{ fontSize: 13, ...S.sub, flex: 1 }}>
                  {m.kind === "washer" ? "Lavatrice" : "Asciugatrice"}
                  {!m.bookable && " · non presente"}
                </span>
                {m.bookable && (
                  <button style={S.danger} disabled={busy === `${l.id}-${m.code}`} onClick={() => toggle(l, m)}>
                    {m.oos ? "Rimetti in servizio" : "Segna fuori servizio"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Settimana ───────────────────────────────────────────────────────────────

function Settimana({ laundries }: { laundries: Laundry[] }) {
  const [id, setId] = useState(laundries[0]?.id ?? 0);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ week_start: string; bookings: Booking[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await call("week", { laundry_id: id, offset })); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }, [id, offset]);

  useEffect(() => { load(); }, [load]);

  async function remove(b: Booking) {
    if (!confirm(`Cancellare la prenotazione della camera ${b.room}?\n${DAYS[b.day]} ${slotLabel(b.slot)} · ${b.machine}`)) return;
    try { await call("deleteBooking", { id: b.id }); load(); }
    catch (e: any) { alert(e.message); }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {laundries.map((l) => (
          <button key={l.id} onClick={() => setId(l.id)}
            style={{ ...S.btn, ...(l.id === id ? { background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" } : {}) }}>
            {l.name}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button style={S.btn} onClick={() => setOffset((o) => o - 1)}>← precedente</button>
        <button style={S.btn} onClick={() => setOffset(0)} disabled={offset === 0}>corrente</button>
        <button style={S.btn} onClick={() => setOffset((o) => o + 1)}>successiva →</button>
      </div>

      <div style={{ ...S.card, padding: 18 }}>
        <p style={{ fontSize: 12, ...S.sub, marginBottom: 14 }}>
          Settimana dal {data?.week_start ?? "…"} · {data?.bookings.length ?? 0} prenotazioni
        </p>

        {busy && <p style={{ fontSize: 13, ...S.sub }}>Caricamento…</p>}

        {!busy && data?.bookings.length === 0 && (
          <p style={{ fontSize: 13, ...S.sub }}>Nessuna prenotazione in questa settimana.</p>
        )}

        <div style={{ display: "grid", gap: 6 }}>
          {data?.bookings.map((b) => (
            <div key={b.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "9px 12px",
              borderRadius: 10, border: "1px solid var(--border)",
            }}>
              <span style={{ fontSize: 13, minWidth: 40, fontWeight: 600 }}>{DAYS[b.day]}</span>
              <span style={{ fontSize: 13, fontFamily: "monospace", minWidth: 48 }}>{slotLabel(b.slot)}</span>
              <span style={{ fontSize: 13, fontFamily: "monospace", minWidth: 44 }}>{b.machine}</span>
              <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
                camera {b.room}
                {b.by === "admin" && <span style={{ fontSize: 11, ...S.sub, marginLeft: 8 }}>(inserita da admin)</span>}
              </span>
              <button style={S.danger} onClick={() => remove(b)}>Cancella</button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Segnalazioni ────────────────────────────────────────────────────────────

function Segnalazioni() {
  const [items, setItems] = useState<Feedback[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { setItems((await call("feedback", { only_open: onlyOpen })).items); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }, [onlyOpen]);

  useEffect(() => { load(); }, [load]);

  async function mark(f: Feedback) {
    try { await call("markFeedback", { id: f.id, handled: !f.handled }); load(); }
    catch (e: any) { alert(e.message); }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button style={{ ...S.btn, ...(onlyOpen ? { background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" } : {}) }}
          onClick={() => setOnlyOpen(true)}>Da gestire</button>
        <button style={{ ...S.btn, ...(!onlyOpen ? { background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" } : {}) }}
          onClick={() => setOnlyOpen(false)}>Tutte</button>
      </div>

      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16 }}>
        Qui arrivano le segnalazioni dei residenti, comprese quelle di guasto: da quando il fuori servizio
        è riservato agli amministratori, è questo il canale con cui si scopre che una macchina è rotta.
      </p>

      {busy && <p style={{ fontSize: 13, ...S.sub }}>Caricamento…</p>}
      {!busy && items.length === 0 && (
        <p style={{ fontSize: 13, ...S.sub }}>Nessuna segnalazione{onlyOpen ? " da gestire" : ""}.</p>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {items.map((f) => {
          const guasto = f.body.startsWith("[GUASTO");
          return (
            <div key={f.id} style={{
              ...S.card, padding: 14,
              borderColor: guasto && !f.handled ? "var(--destructive)" : "var(--border)",
              opacity: f.handled ? 0.6 : 1,
            }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>
                  {f.room ? `Camera ${f.room}` : "Anonimo"}
                </span>
                {f.laundry && <span style={{ fontSize: 11, ...S.sub }}>{f.laundry}</span>}
                {guasto && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--destructive)" }}>GUASTO</span>}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11, ...S.sub }}>
                  {new Date(f.created_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
              <p style={{ fontSize: 14, marginBottom: 10, whiteSpace: "pre-wrap" }}>{f.body}</p>
              <button style={S.btn} onClick={() => mark(f)}>
                {f.handled ? "Riapri" : "Segna come gestita"}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Sale ────────────────────────────────────────────────────────────────────

function Sale() {
  const [items, setItems] = useState<SpaceBooking[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { setItems((await call("spaces")).items); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(b: SpaceBooking) {
    if (!confirm(`Cancellare la prenotazione di ${b.name}?`)) return;
    try { await call("deleteSpaceBooking", { id: b.id }); load(); }
    catch (e: any) { alert(e.message); }
  }

  return (
    <div style={{ ...S.card, padding: 18 }}>
      <p style={{ fontSize: 12, ...S.sub, marginBottom: 14 }}>
        Settimana corrente · {items.length} prenotazioni
      </p>
      {busy && <p style={{ fontSize: 13, ...S.sub }}>Caricamento…</p>}
      {!busy && items.length === 0 && <p style={{ fontSize: 13, ...S.sub }}>Nessuna prenotazione.</p>}

      <div style={{ display: "grid", gap: 6 }}>
        {items.map((b) => (
          <div key={b.id} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "9px 12px",
            borderRadius: 10, border: "1px solid var(--border)",
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, minWidth: 56, textTransform: "capitalize" }}>{b.space}</span>
            <span style={{ fontSize: 13, minWidth: 40 }}>{DAYS[b.day]}</span>
            <span style={{ fontSize: 13, fontFamily: "monospace", minWidth: 96 }}>
              {timeLabel(b.start)}–{timeLabel(b.end)}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
              {b.name}
              {b.type && <span style={{ fontSize: 11, ...S.sub, marginLeft: 8 }}>{b.type}</span>}
            </span>
            <button style={S.danger} onClick={() => remove(b)}>Cancella</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Guscio ──────────────────────────────────────────────────────────────────

export default function Admin() {
  const [logged, setLogged] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("macchine");
  const [laundries, setLaundries] = useState<Laundry[]>([]);

  const loadOverview = useCallback(async () => {
    try { setLaundries((await call("overview")).laundries); }
    catch (e: any) { if (e.message === "SESSIONE_SCADUTA") setLogged(false); }
  }, []);

  useEffect(() => {
    fetch("/api/admin/auth")
      .then((r) => r.json())
      .then((d) => setLogged(Boolean(d.logged)))
      .catch(() => setLogged(false));
  }, []);

  useEffect(() => { if (logged) loadOverview(); }, [logged, loadOverview]);

  async function logout() {
    await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setLogged(false);
  }

  if (logged === null) {
    return <div style={{ ...S.page, display: "grid", placeItems: "center" }}>
      <p style={S.sub}>Caricamento…</p>
    </div>;
  }
  if (!logged) return <Login onDone={() => setLogged(true)} />;

  const TABS: [Tab, string][] = [
    ["macchine", "Macchine"],
    ["settimana", "Prenotazioni"],
    ["segnalazioni", "Segnalazioni"],
    ["sale", "Sale"],
  ];

  return (
    <div style={S.page}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px 60px" }}>
        <header style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", ...S.sub }}>EinaudiPlus</p>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>Amministrazione</h1>
          </div>
          <div style={{ flex: 1 }} />
          <a href="/" style={{ ...S.btn, textDecoration: "none" }}>App</a>
          <button style={S.btn} onClick={logout}>Esci</button>
        </header>

        <nav style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ ...S.btn, ...(tab === k ? { background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" } : {}) }}>
              {label}
            </button>
          ))}
        </nav>

        {tab === "macchine" && <Macchine laundries={laundries} reload={loadOverview} />}
        {tab === "settimana" && laundries.length > 0 && <Settimana laundries={laundries} />}
        {tab === "segnalazioni" && <Segnalazioni />}
        {tab === "sale" && <Sale />}
      </div>
    </div>
  );
}
