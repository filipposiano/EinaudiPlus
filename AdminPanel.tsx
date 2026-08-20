// Schermate amministrative — si aprono dal menu Impostazioni dell'app.
//
// Tengono solo cio' che nell'app normale non esiste: lo stato delle macchine,
// le segnalazioni dei residenti e, per il sistemista, regole ricorrenti e
// pulizia.
//
// Prenotare e cancellare NON si fa da qui: si fa nell'app principale, dove chi
// ha una sessione admin puo' agire a nome della DIREZIONE su qualsiasi turno.
//
// Caricato in lazy da App.tsx: non pesa sul bundle dei residenti.

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
type Feedback = { id: number; room: string | null; body: string; laundry: string | null; created_at: string; handled: boolean };

type Recurring = {
  id: number; kind: "laundry" | "space"; day: number; active: boolean; note?: string;
  laundry?: string; laundry_id?: number; slot?: number; machine?: string; room?: string;
  space?: string; space_id?: number; start?: number; end?: number; name?: string; type?: string;
};

export type Role = "fdo" | "sistemista";
export type Tab = "macchine" | "segnalazioni" | "ricorrenti" | "manutenzione";

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
  sub: { color: "var(--gray-accessible-text)" } as const,
  btn: {
    padding: "8px 14px", borderRadius: 12, fontSize: 13, fontWeight: 600,
    border: "1px solid var(--border)", background: "var(--secondary)",
    color: "var(--foreground)", cursor: "pointer",
  } as const,
  danger: {
    padding: "6px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer",
    border: "none", background: "color-mix(in srgb, var(--destructive-text) 12%, transparent)",
    color: "var(--destructive-text)",
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
    <div style={{ display: "grid", placeItems: "center" }}>
      <form onSubmit={submit} style={{ ...S.card, padding: 24, width: "100%", maxWidth: 360 }}>
        <p style={{ fontSize: 13, ...S.sub, marginBottom: 18 }}>
          Le voci di amministrazione compaiono in questo menu dopo l'accesso.
        </p>

        <label style={{ fontSize: 12, ...S.sub }}>Utente</label>
        <input style={{ ...S.input, marginBottom: 12 }} value={username} autoFocus
               onChange={(e) => setUsername(e.target.value)} autoComplete="username" />

        <label style={{ fontSize: 12, ...S.sub }}>Password</label>
        <input style={{ ...S.input, marginBottom: 18 }} type="password" value={password}
               onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />

        {err && <p style={{ fontSize: 13, color: "var(--destructive-text)", marginBottom: 12 }}>{err}</p>}

        <button type="submit" disabled={busy}
          style={{ ...S.btn, width: "100%", padding: 12, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" }}>
          {busy ? "Accesso…" : "Entra"}
        </button>
      </form>
    </div>
  );
}

// ─── Scheda macchina ─────────────────────────────────────────────────────────
//
// Prima era una riga con scritto "W-A", che non dice niente a chi la legge.
// Qui si vede una lavatrice o un'asciugatrice, con il cestello che gira quando
// è in servizio e si ferma quando non lo è: lo stato si capisce a colpo
// d'occhio, senza leggere.
//
// L'interruttore è la metafora giusta perché è quello che si fa davvero con
// una macchina rotta: la si spegne.

function Oblo({ kind, acceso }: { kind: "washer" | "dryer"; acceso: boolean }) {
  const colore = acceso ? "var(--status-free-text)" : "var(--destructive-text)";
  return (
    <svg viewBox="0 0 64 72" width="72" height="81" aria-hidden="true"
         style={{ display: "block", margin: "0 auto" }}>
      {/* Corpo */}
      <rect x="4" y="4" width="56" height="64" rx="7"
            fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      {/* Pannello comandi */}
      <path d="M4 20 H60" stroke="var(--border)" strokeWidth="2" />
      <circle cx="13" cy="12" r="2.5" fill={colore} opacity={acceso ? 1 : 0.35} />
      <rect x="22" y="10" width="30" height="4" rx="2" fill="var(--border)" />

      {/* Oblò */}
      <circle cx="32" cy="44" r="18" fill="var(--background)"
              stroke="var(--border)" strokeWidth="2" />
      <circle cx="32" cy="44" r="13.5" fill="none" stroke={colore}
              strokeWidth="2" opacity={acceso ? 0.5 : 0.3} />

      {/* Cestello: gira solo se la macchina è in servizio.
          L'asciugatrice gira più lenta, come quella vera. */}
      <g style={acceso ? {
        transformOrigin: "32px 44px",
        animation: `adminDrum ${kind === "dryer" ? "3.2s" : "1.9s"} linear infinite`,
      } : undefined}>
        <path d="M32 33 A11 11 0 0 1 43 44" fill="none" stroke={colore}
              strokeWidth="3.5" strokeLinecap="round" opacity={acceso ? 0.9 : 0.35} />
        <path d="M32 55 A11 11 0 0 1 21 44" fill="none" stroke={colore}
              strokeWidth="3.5" strokeLinecap="round" opacity={acceso ? 0.9 : 0.35} />
      </g>

      {/* Croce quando è fuori servizio */}
      {!acceso && (
        <g stroke="var(--destructive-text)" strokeWidth="3.5" strokeLinecap="round">
          <path d="M24 36 L40 52" />
          <path d="M40 36 L24 52" />
        </g>
      )}
    </svg>
  );
}

function MacchinaCard({ machine, busy, onToggle }: {
  machine: Machine; busy: boolean; onToggle: () => void;
}) {
  const acceso = !machine.oos;
  const nome = (machine.kind === "washer" ? "Lavatrice " : "Asciugatrice ") + machine.code.slice(-1);

  return (
    <div style={{
      border: `1px solid ${acceso ? "var(--border)" : "var(--destructive-text)"}`,
      borderRadius: 16,
      padding: "16px 12px 12px",
      textAlign: "center",
      background: acceso ? "transparent" : "color-mix(in srgb, var(--destructive-text) 7%, transparent)",
      transition: "border-color .2s, background .2s",
      opacity: busy ? 0.55 : 1,
    }}>
      <Oblo kind={machine.kind} acceso={acceso} />

      <p style={{ fontSize: 14, fontWeight: 700, marginTop: 10 }}>{nome}</p>
      <p style={{ fontSize: 12, marginBottom: 12, color: acceso ? "var(--status-free-text)" : "var(--destructive-text)" }}>
        {acceso ? "In servizio" : "Fuori servizio"}
      </p>

      {/* Interruttore */}
      <button
        onClick={onToggle}
        disabled={busy}
        role="switch"
        aria-checked={acceso}
        aria-label={`${nome}: ${acceso ? "spegni, segna fuori servizio" : "riaccendi, rimetti in servizio"}`}
        title={acceso ? "Spegni — segna fuori servizio" : "Riaccendi — rimetti in servizio"}
        style={{
          width: 52, height: 30, borderRadius: 99, border: "none", padding: 3,
          cursor: busy ? "default" : "pointer",
          background: acceso ? "var(--status-free-text)" : "var(--destructive-text)",
          display: "flex", justifyContent: acceso ? "flex-end" : "flex-start",
          transition: "background .2s",
        }}>
        <span style={{
          width: 24, height: 24, borderRadius: 99, background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "all .2s",
        }} />
      </button>
    </div>
  );
}

// ─── Macchine ────────────────────────────────────────────────────────────────

/** Le macchine reali raggruppate per lettera, lavatrice prima dell'asciugatrice. */
function gruppiPerLettera(machines: Machine[]): [string, Machine[]][] {
  const per = new Map<string, Machine[]>();
  for (const m of machines) {
    if (!m.bookable) continue;
    const lettera = m.code.slice(-1);
    (per.get(lettera) ?? per.set(lettera, []).get(lettera)!).push(m);
  }
  return [...per.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lettera, ms]) => [
      lettera,
      ms.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "washer" ? -1 : 1)),
    ]);
}

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
        L'interruttore spegne la macchina e la segna fuori servizio. Chi prenota vede un avviso,
        ma <strong>può prenotarla lo stesso</strong>: lo stato informa, non blocca.
      </p>

      {laundries.map((l) => (
        <div key={l.id} style={{ ...S.card, padding: 18, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>{l.name}</h2>
            <span style={{ fontSize: 12, ...S.sub }}>
              camere {l.rooms} · {l.bookings} prenotazioni questa settimana
            </span>
          </div>

          {/* Raggruppate per lettera, non in un elenco piatto: lavatrice e
              asciugatrice della stessa lettera sono la coppia che il residente
              usa di fila (lava in A, asciuga in A), quindi è quella la coppia
              che l'amministratore guarda insieme quando qualcosa non va.

              Le lettere si ricavano dai dati e non sono fisse A/B/C: alla
              Manica esiste solo la A, e una colonna vuota per B e C sarebbe
              rumore senza niente da farci.

              Solo le macchine che esistono davvero: nel database ci sono tutte
              e sei le sigle per ogni lavanderia perché il client le indicizza
              per posizione. */}
          <div style={{
            display: "grid", gap: 14,
            gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
          }}>
            {gruppiPerLettera(l.machines).map(([lettera, gruppo]) => (
              <div key={lettera} style={{
                border: "1px solid var(--border)", borderRadius: 14, padding: "10px 10px 12px",
              }}>
                <p style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                  textAlign: "center", marginBottom: 8, ...S.sub,
                }}>Gruppo {lettera}</p>

                <div style={{ display: "grid", gap: 10, gridTemplateColumns: `repeat(${gruppo.length}, 1fr)` }}>
                  {gruppo.map((m) => (
                    <MacchinaCard
                      key={m.code}
                      machine={m}
                      busy={busy === `${l.id}-${m.code}`}
                      onToggle={() => toggle(l, m)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
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
              borderColor: guasto && !f.handled ? "var(--destructive-text)" : "var(--border)",
              opacity: f.handled ? 0.6 : 1,
            }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>
                  {f.room ? `Camera ${f.room}` : "Anonimo"}
                </span>
                {f.laundry && <span style={{ fontSize: 11, ...S.sub }}>{f.laundry}</span>}
                {guasto && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--destructive-text)" }}>GUASTO</span>}
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
  const [chiesto, setChiesto] = useState<string | null>(null);   // ambito in attesa di conferma
  const [parola, setParola] = useState("");

  // La conferma sta dentro la pagina e non in window.confirm().
  //
  // confirm() è bloccato in diversi contesti — PWA installata, iframe senza
  // allow-modals — e quando lo è ritorna false senza mostrare niente: il
  // pulsante sembrava semplicemente non funzionare. "Azzera tutto" ne aveva
  // due di fila, quindi era il primo a dare quell'impressione.
  //
  // Qui invece si vede sempre cosa sta succedendo, e per l'azzeramento totale
  // si deve scrivere una parola: non basta un doppio clic distratto.
  async function esegui(scope: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await call("purge", { scope });
      const righe = Object.entries(r.cancellati || {})
        .filter(([, v]) => v !== 0 && v !== false)
        .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
        .join(" · ");
      setMsg(righe ? "Fatto — " + righe : "Fatto. Non c'era nulla da cancellare.");
      setChiesto(null); setParola("");
    } catch (e: any) {
      setMsg("Non è riuscito: " + e.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16 }}>
        Operazioni distruttive e non annullabili. Il registro delle azioni non viene mai
        cancellato: serve proprio a sapere chi ha svuotato cosa e quando.
      </p>

      {msg && <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      <div style={{ display: "grid", gap: 10 }}>
        {AMBITI.map(([scope, label, desc]) => {
          const inAttesa = chiesto === scope;
          const totale   = scope === "tutto";
          // Per l'azzeramento totale serve scrivere la parola: un clic di
          // troppo non deve poter svuotare tutto.
          const puoi = !totale || parola.trim().toUpperCase() === "AZZERA";

          return (
            <div key={scope} style={{
              ...S.card, padding: 14,
              borderColor: totale || inAttesa ? "var(--destructive-text)" : "var(--border)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600 }}>{label}</p>
                  <p style={{ fontSize: 12, ...S.sub }}>{desc}</p>
                </div>
                {!inAttesa && (
                  <button style={S.danger} disabled={busy}
                    onClick={() => { setChiesto(scope); setParola(""); setMsg(null); }}>
                    Esegui
                  </button>
                )}
              </div>

              {inAttesa && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
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
                      onClick={() => esegui(scope)}>
                      {busy ? "In corso…" : totale ? "Azzera tutto" : "Sì, procedi"}
                    </button>
                    <button style={S.btn} disabled={busy}
                      onClick={() => { setChiesto(null); setParola(""); }}>
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

// ─── Guscio ──────────────────────────────────────────────────────────────────
//
// Non e' piu' una pagina a se': e' una schermata che si apre sopra l'app
// normale, dal menu Impostazioni. Un amministratore usa esattamente la stessa
// app di tutti gli altri — stessa dashboard, stesse prenotazioni — e in piu'
// trova nel menu le voci che qui dentro vivono. Il login sta nello stesso
// posto, perche' e' li' che uno va a cercarlo.
//
// La pagina /admin separata voleva dire due interfacce da mantenere e un
// amministratore che, per prenotare a nome della DIREZIONE, doveva comunque
// tornare sull'app: la separazione non pagava niente.

export function AdminSheet({ tab, onClose, onSession }: {
  tab: Tab | null;                     // null = si apre sul login
  onClose: () => void;
  onSession: (role: Role | null) => void;   // per riallineare l'app dopo login/logout
}) {
  const [logged, setLogged] = useState<boolean | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [current, setCurrent] = useState<Tab>(tab ?? "macchine");
  const [laundries, setLaundries] = useState<Laundry[]>([]);

  const loadOverview = useCallback(async () => {
    try { setLaundries((await call("overview")).laundries); }
    catch (e: any) { if (e.message === "SESSIONE_SCADUTA") { setLogged(false); onSession(null); } }
  }, [onSession]);

  const refreshSession = useCallback(() => {
    fetch("/api/admin/auth")
      .then((r) => r.json())
      .then((d) => {
        setLogged(Boolean(d.logged));
        setRole(d.role || null);
        onSession(d.logged ? (d.role as Role) : null);
      })
      .catch(() => { setLogged(false); onSession(null); });
  }, [onSession]);

  useEffect(() => { refreshSession(); }, [refreshSession]);
  useEffect(() => { if (logged) loadOverview(); }, [logged, loadOverview]);

  async function logout() {
    await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setLogged(false); setRole(null);
    onSession(null);
    onClose();
  }

  const sistemista = role === "sistemista";

  // Le schede riservate si nascondono, ma il controllo vero sta sul server:
  // nascondere un pulsante non e' un'autorizzazione.
  const TABS: [Tab, string][] = [
    ["macchine", "Macchine"],
    ["segnalazioni", "Segnalazioni"],
    ...(sistemista ? ([["ricorrenti", "Ricorrenti"], ["manutenzione", "Manutenzione"]] as [Tab, string][]) : []),
  ];

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: "var(--background)", display: "flex", flexDirection: "column",
    }}>
      <header style={{
        display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
        padding: "16px 20px", borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 17, fontWeight: 700 }}>Amministrazione</h1>
          {/* Solo il ruolo, non anche il nome utente: c'e' un account per
              ruolo e i due valori coincidono ("fdo" col badge FDO), quindi
              stamparli entrambi dava "sistemistaSISTEMISTA". */}
          {logged && (
            <p style={{ fontSize: 11, ...S.sub }}>
              <span style={{
                padding: "1px 7px", borderRadius: 99, fontSize: 10,
                fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                background: "color-mix(in srgb, var(--primary) 15%, transparent)",
                color: "var(--primary)",
              }}>{sistemista ? "sistemista" : "FDO"}</span>
            </p>
          )}
        </div>
        <div style={{ flex: 1 }} />
        {logged && <button style={S.btn} onClick={logout}>Esci</button>}
        <button style={S.btn} onClick={onClose} aria-label="Chiudi">Chiudi</button>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 20px 40px" }}>
        {logged === null && <p style={{ fontSize: 13, ...S.sub }}>Caricamento…</p>}

        {logged === false && <Login onDone={refreshSession} />}

        {logged === true && (
          <>
            <nav style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
              {TABS.map(([k, label]) => (
                <button key={k} onClick={() => setCurrent(k)}
                  style={{ ...S.btn, ...(current === k ? { background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" } : {}) }}>
                  {label}
                </button>
              ))}
            </nav>

            {current === "macchine" && <Macchine laundries={laundries} reload={loadOverview} />}
            {current === "segnalazioni" && <Segnalazioni />}
            {current === "ricorrenti" && sistemista && laundries.length > 0 && <Ricorrenti laundries={laundries} />}
            {current === "manutenzione" && sistemista && <Manutenzione />}
          </>
        )}
      </div>
    </div>
  );
}
