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
  id: number; slug: string; name: string;
  rooms: string;        // testo per chi legge, es. "dal 100 in su"
  sample_room: string;  // una camera qualsiasi, per le chiamate che ne hanno bisogno
  quota: number; reminders: string; week_start: string;
  bookings: number; machines: Machine[];
};
type Booking = { id: number; day: number; slot: number; machine: string; room: string; by: string };
type Feedback = { id: number; room: string | null; body: string; laundry: string | null; created_at: string; handled: boolean };
type SpaceBooking = { id: number; space: string; day: number; start: number; end: number; name: string; type: string | null };

type Recurring = {
  id: number; kind: "laundry" | "space"; day: number; active: boolean; note?: string;
  laundry?: string; laundry_id?: number; slot?: number; machine?: string; room?: string;
  space?: string; space_id?: number; start?: number; end?: number; name?: string; type?: string;
};

type Role = "portineria" | "sistemista";
type Tab = "macchine" | "settimana" | "segnalazioni" | "sale" | "ricorrenti" | "manutenzione";

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
        room: l.sample_room, machine: m.code, oos: !m.oos,
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

// ─── Regole ricorrenti (sistemista) ──────────────────────────────────────────
//
// Una regola non è una prenotazione: è la ricetta con cui, ogni notte, le
// prenotazioni della settimana corrente vengono create. Cancellare la regola
// non cancella le prenotazioni già scritte — quelle restano fino a fine
// settimana e si tolgono dalla scheda Prenotazioni.

function Ricorrenti({ laundries }: { laundries: Laundry[] }) {
  const [items, setItems] = useState<Recurring[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Form lavanderia
  const [lid, setLid] = useState(laundries[0]?.id ?? 0);
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState(0);
  const [machine, setMachine] = useState("W-A");
  const [room, setRoom] = useState("");

  // Form sala
  const [space, setSpace] = useState<"cinema" | "music">("cinema");
  const [sDay, setSDay] = useState(0);
  const [sStart, setSStart] = useState("21:00");
  const [sEnd, setSEnd] = useState("23:00");
  const [sName, setSName] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try { setItems((await call("recurringList")).items); }
    catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  async function addLaundry() {
    if (!room.trim()) { setMsg("Indica la camera."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await call("recurringAddLaundry", {
        laundry_id: lid, day, slot, machine, room: room.trim(),
      });
      setMsg(r.ok ? "Regola creata e applicata a questa settimana." : r.error);
      setRoom(""); load();
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function addSpace() {
    if (!sName.trim()) { setMsg("Indica un nome."); return; }
    setBusy(true); setMsg(null);
    try {
      await call("recurringAddSpace", {
        space_id: space === "cinema" ? 1 : 2, day: sDay,
        start: toMin(sStart), end: toMin(sEnd), name: sName.trim(),
      });
      setMsg("Regola creata e applicata a questa settimana.");
      setSName(""); load();
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function remove(r: Recurring) {
    if (!confirm("Eliminare la regola?\n\nLe prenotazioni già create restano fino a fine settimana: si tolgono dalla scheda Prenotazioni.")) return;
    try { await call("recurringDelete", { id: r.id }); load(); }
    catch (e: any) { setMsg(e.message); }
  }

  async function toggle(r: Recurring) {
    try { await call("recurringSetActive", { id: r.id, active: !r.active }); load(); }
    catch (e: any) { setMsg(e.message); }
  }

  async function applyNow() {
    setBusy(true);
    try {
      const r = await call("applyRecurring", { offset: 0 });
      setMsg(`Applicate: ${r.lavanderia} in lavanderia, ${r.sale} nelle sale, ${r.saltate} già occupate.`);
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  const machines = laundries.find((l) => l.id === lid)?.machines.filter((m) => m.bookable) ?? [];

  return (
    <>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16 }}>
        Le regole vengono applicate ogni notte alla settimana corrente. Una regola creata adesso
        vale già da subito. Cancellare una regola <strong>non</strong> cancella le prenotazioni
        già create: quelle restano fino a fine settimana.
      </p>

      {msg && (
        <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>
      )}

      {/* Nuova regola lavanderia */}
      <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Nuova regola · lavanderia</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          <select style={S.input} value={lid} onChange={(e) => setLid(Number(e.target.value))}>
            {laundries.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select style={S.input} value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {DAYS.map((d, i) => <option key={i} value={i}>Ogni {d.toLowerCase()}</option>)}
          </select>
          <select style={S.input} value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
            {Array.from({ length: 19 }, (_, i) => <option key={i} value={i}>{slotLabel(i)}</option>)}
          </select>
          <select style={S.input} value={machine} onChange={(e) => setMachine(e.target.value)}>
            {machines.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}
          </select>
          <input style={S.input} placeholder="Camera" value={room} onChange={(e) => setRoom(e.target.value)} />
          <button style={{ ...S.btn, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" }}
                  disabled={busy} onClick={addLaundry}>Aggiungi</button>
        </div>
      </div>

      {/* Nuova regola sala */}
      <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Nuova regola · sala</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          <select style={S.input} value={space} onChange={(e) => setSpace(e.target.value as any)}>
            <option value="cinema">Cinema</option>
            <option value="music">Musica</option>
          </select>
          <select style={S.input} value={sDay} onChange={(e) => setSDay(Number(e.target.value))}>
            {DAYS.map((d, i) => <option key={i} value={i}>Ogni {d.toLowerCase()}</option>)}
          </select>
          <input style={S.input} type="time" value={sStart} onChange={(e) => setSStart(e.target.value)} />
          <input style={S.input} type="time" value={sEnd} onChange={(e) => setSEnd(e.target.value)} />
          <input style={S.input} placeholder="Nome" value={sName} onChange={(e) => setSName(e.target.value)} />
          <button style={{ ...S.btn, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" }}
                  disabled={busy} onClick={addSpace}>Aggiungi</button>
        </div>
      </div>

      {/* Elenco */}
      <div style={{ ...S.card, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>Regole attive ({items.length})</h2>
          <button style={S.btn} disabled={busy} onClick={applyNow}>Applica ora</button>
        </div>

        {items.length === 0 && <p style={{ fontSize: 13, ...S.sub }}>Nessuna regola.</p>}

        <div style={{ display: "grid", gap: 6 }}>
          {items.map((r) => (
            <div key={r.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "9px 12px",
              borderRadius: 10, border: "1px solid var(--border)", opacity: r.active ? 1 : 0.5,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, minWidth: 64, ...S.sub }}>
                {r.kind === "laundry" ? "LAVANDERIA" : "SALA"}
              </span>
              <span style={{ fontSize: 13, minWidth: 96 }}>ogni {DAYS[r.day].toLowerCase()}</span>
              <span style={{ fontSize: 13, fontFamily: "monospace", flex: 1 }}>
                {r.kind === "laundry"
                  ? `${slotLabel(r.slot!)} · ${r.machine} · camera ${r.room}`
                  : `${r.space} · ${timeLabel(r.start!)}–${timeLabel(r.end!)} · ${r.name}`}
              </span>
              <button style={S.btn} onClick={() => toggle(r)}>{r.active ? "Sospendi" : "Riattiva"}</button>
              <button style={S.danger} onClick={() => remove(r)}>Elimina</button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Manutenzione (sistemista) ───────────────────────────────────────────────

const AMBITI: [string, string, string][] = [
  ["settimana",    "Svuota la settimana corrente",  "Toglie tutte le prenotazioni di questa settimana, lavanderia e sale. Lo storico resta."],
  ["prenotazioni", "Tutte le prenotazioni",          "Cancella anche lo storico delle settimane passate."],
  ["segnalazioni", "Tutte le segnalazioni",          "Svuota la lista dei feedback, gestiti e non."],
  ["notifiche",    "Tutte le iscrizioni",            "Push e Telegram. Chi li aveva attivi dovrà riattivarli."],
  ["ricorrenti",   "Tutte le regole ricorrenti",     "Le prenotazioni già create restano."],
  ["tutto",        "Azzera tutto",                   "Tutto quanto sopra, e rimette in servizio le macchine. La configurazione e il registro delle azioni restano."],
];

function Manutenzione() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function purge(scope: string, label: string) {
    if (!confirm(`${label}\n\nL'operazione non è annullabile. Procedere?`)) return;
    if (scope === "tutto" && !confirm("Conferma definitiva: azzerare TUTTI i dati?")) return;

    setBusy(true); setMsg(null);
    try {
      const r = await call("purge", { scope });
      const righe = Object.entries(r.cancellati || {})
        .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ");
      setMsg(righe || "Nessun dato da cancellare.");
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16 }}>
        Operazioni distruttive e non annullabili. Il registro delle azioni non viene mai
        cancellato: serve proprio a sapere chi ha svuotato cosa e quando.
      </p>

      {msg && <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      <div style={{ display: "grid", gap: 10 }}>
        {AMBITI.map(([scope, label, desc]) => (
          <div key={scope} style={{
            ...S.card, padding: 14, display: "flex", alignItems: "center", gap: 14,
            borderColor: scope === "tutto" ? "var(--destructive)" : "var(--border)",
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600 }}>{label}</p>
              <p style={{ fontSize: 12, ...S.sub }}>{desc}</p>
            </div>
            <button style={S.danger} disabled={busy} onClick={() => purge(scope, label)}>Esegui</button>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Guscio ──────────────────────────────────────────────────────────────────

export default function Admin() {
  const [logged, setLogged] = useState<boolean | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("macchine");
  const [laundries, setLaundries] = useState<Laundry[]>([]);

  const loadOverview = useCallback(async () => {
    try { setLaundries((await call("overview")).laundries); }
    catch (e: any) { if (e.message === "SESSIONE_SCADUTA") setLogged(false); }
  }, []);

  const refreshSession = useCallback(() => {
    fetch("/api/admin/auth")
      .then((r) => r.json())
      .then((d) => { setLogged(Boolean(d.logged)); setRole(d.role || null); setUser(d.user || null); })
      .catch(() => setLogged(false));
  }, []);

  useEffect(() => { refreshSession(); }, [refreshSession]);

  useEffect(() => { if (logged) loadOverview(); }, [logged, loadOverview]);

  async function logout() {
    await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setLogged(false); setRole(null); setUser(null);
  }

  if (logged === null) {
    return <div style={{ ...S.page, display: "grid", placeItems: "center" }}>
      <p style={S.sub}>Caricamento…</p>
    </div>;
  }
  if (!logged) return <Login onDone={refreshSession} />;

  const sistemista = role === "sistemista";

  // Le schede riservate si nascondono, ma il controllo vero sta sul server:
  // nascondere un pulsante non è un'autorizzazione.
  const TABS: [Tab, string][] = [
    ["macchine", "Macchine"],
    ["settimana", "Prenotazioni"],
    ["segnalazioni", "Segnalazioni"],
    ["sale", "Sale"],
    ...(sistemista ? ([["ricorrenti", "Ricorrenti"], ["manutenzione", "Manutenzione"]] as [Tab, string][]) : []),
  ];

  return (
    <div style={S.page}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px 60px" }}>
        <header style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", ...S.sub }}>EinaudiPlus</p>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>Amministrazione</h1>
            <p style={{ fontSize: 12, ...S.sub }}>
              {user}
              {sistemista && (
                <span style={{
                  marginLeft: 8, padding: "1px 7px", borderRadius: 99, fontSize: 10,
                  fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                  background: "color-mix(in srgb, var(--primary) 15%, transparent)",
                  color: "var(--primary)",
                }}>sistemista</span>
              )}
            </p>
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
        {tab === "ricorrenti" && sistemista && laundries.length > 0 && <Ricorrenti laundries={laundries} />}
        {tab === "manutenzione" && sistemista && <Manutenzione />}
      </div>
    </div>
  );
}
