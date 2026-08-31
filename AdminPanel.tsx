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
import { Trash2 } from "lucide-react";
import type { Occorrenza } from "./conferenzeApi";
import { RuotaOrario } from "./RuotaPicker";

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

// Una REGOLA della sala conferenze, com'e' stata scritta: "ogni martedi' dalle
// 14 alle 18, dal 7 ottobre al 30 maggio". Le singole date non esistono da
// nessuna parte: le calcola il database quando qualcuno legge l'agenda.
// Un account amministrativo. La password non compare mai qui: il pannello la
// invia una volta, in creazione o in reset, e da li' in poi esiste solo come
// hash nel database.
type Account = {
  id: number; username: string; ruolo: Role; attivo: boolean;
  created_at: string; password_at: string; deve_cambiare_password: boolean;
};

type Recurring = {
  id: number; kind: "laundry" | "space"; day: number; active: boolean; note?: string;
  laundry?: string; laundry_id?: number; slot?: number; machine?: string; room?: string;
  space?: string; space_id?: number; start?: number; end?: number; name?: string; type?: string;
};

// `staff` ha gli stessi poteri di `fdo`; solo `sistemista` puo' di piu'.
// Restano account distinti perche' l'audit log registra chi ha fatto cosa.
export type Role = "fdo" | "staff" | "sistemista";
export type Tab = "macchine" | "segnalazioni" | "account" | "ricorrenti" | "manutenzione";

// ─── Chiamate ────────────────────────────────────────────────────────────────

async function call<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/admin/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-requested-with": "admin" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (res.status === 401) throw new Error("SESSIONE_SCADUTA");
  const data = await res.json();
  if (!data.ok) {
    // I campi oltre `error` restano attaccati all'eccezione: alcune funzioni
    // SQL spiegano il rifiuto invece di limitarsi a nominarlo — `con` e
    // `quando` dicono con quale evento e in che data una programmazione si
    // sovrappone. Buttarli via lasciava all'utente il compito di cercarlo.
    const err = Object.assign(new Error(data.error || "errore"), data);
    throw err;
  }
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
    border: "none", background: "color-mix(in srgb, var(--destructive) 12%, transparent)",
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
          Dopo l'accesso le sezioni riservate compaiono accanto a Lavanderia,
          Cinema e Musica, e prenoti come Direzione.
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

// Lavatrice e asciugatrice hanno colori diversi perché stanno affiancate e si
// somigliano: a colpo d'occhio la coppia si distingue dal colore, non dalla
// scritta. Il rosso del fuori servizio vince su entrambi — è quella
// l'informazione che conta.
const TINTA = {
  washer: "var(--tinta-lavatrice)",
  dryer:  "var(--tinta-asciugatrice)",
} as const;

const coloreDi = (kind: "washer" | "dryer", acceso: boolean) =>
  acceso ? TINTA[kind] : "var(--destructive-text)";

function Oblo({ kind, acceso }: { kind: "washer" | "dryer"; acceso: boolean }) {
  const colore = coloreDi(kind, acceso);
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
  const colore = coloreDi(machine.kind, acceso);
  const tipo = machine.kind === "washer" ? "Lavatrice" : "Asciugatrice";
  const nome = `${tipo} ${machine.code.slice(-1)}`;

  return (
    <div style={{
      border: `1px solid ${acceso ? `color-mix(in srgb, ${colore} 35%, transparent)` : "var(--destructive-text)"}`,
      borderRadius: 16,
      padding: "14px 10px 12px",
      textAlign: "center",
      background: `color-mix(in srgb, ${colore} ${acceso ? "6%" : "9%"}, transparent)`,
      transition: "border-color .2s, background .2s",
      opacity: busy ? 0.55 : 1,
      minWidth: 0,
    }}>
      <Oblo kind={machine.kind} acceso={acceso} />

      {/* Il tipo va a capo da solo: "Asciugatrice" su una scheda stretta
          rientrava a metà parola. */}
      <p style={{ fontSize: 13, fontWeight: 700, marginTop: 8, lineHeight: 1.25, color: colore }}>
        {tipo}
      </p>
      <p style={{ fontSize: 11, marginBottom: 10, ...S.sub }}>
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
          width: 48, height: 28, borderRadius: 99, border: "none", padding: 3,
          cursor: busy ? "default" : "pointer", margin: "0 auto",
          background: colore,
          display: "flex", justifyContent: acceso ? "flex-end" : "flex-start",
          transition: "background .2s",
        }}>
        <span style={{
          width: 22, height: 22, borderRadius: 99, background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "all .2s",
        }} />
      </button>
    </div>
  );
}

// ─── Macchine ────────────────────────────────────────────────────────────────

type Gruppo = { chiave: string; titolo: string; machines: Machine[] };

/**
 * I gruppi di UNA lavanderia: A, B, C.
 *
 * Il gruppo è l'unità di lettura — la coppia lavatrice+asciugatrice che il
 * residente usa di fila — e sopra ci sta il nome dell'edificio, che le tiene
 * separate. Le lettere si ricavano dai dati: nel database ci sono tutte e sei
 * le sigle per ogni lavanderia perché il client le indicizza per posizione, ma
 * solo le `bookable` esistono davvero.
 *
 * Se la lavanderia ha un gruppo solo la lettera sparisce: alla Manica quella
 * macchina è "la lavatrice della Manica" per chiunque ci lavori, non "la A" —
 * e il titolo dell'edificio lo dice già lì sopra.
 */
function gruppiDiLavanderia(l: Laundry): Gruppo[] {
  const per = new Map<string, Machine[]>();
  for (const m of l.machines) {
    if (!m.bookable) continue;
    const lettera = m.code.slice(-1);
    (per.get(lettera) ?? per.set(lettera, []).get(lettera)!).push(m);
  }

  const lettere = [...per.keys()].sort((a, b) => a.localeCompare(b));

  return lettere.map((lettera) => ({
    chiave: `${l.id}-${lettera}`,
    titolo: `Gruppo ${lettera}`,
    machines: per.get(lettera)!.sort(
      (a, b) => (a.kind === b.kind ? 0 : a.kind === "washer" ? -1 : 1)
    ),
  }));
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

      {/* Una sezione per edificio, separata da una riga.
          Sono due lavanderie fisicamente distinte, in due palazzi diversi, e
          in un elenco unico "Gruppo A" del Valentino e la macchina della
          Manica finivano appaiate come se stessero nella stessa stanza —
          con il rischio di spegnere la macchina sbagliata. */}
      {laundries.map((l, i) => {
        const gruppi = gruppiDiLavanderia(l);
        if (gruppi.length === 0) return null;
        return (
          <section key={l.id} style={{ marginBottom: 20 }}>
            <div style={{
              display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10,
              paddingTop: i === 0 ? 0 : 14,
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
            }}>
              <h2 style={{ fontSize: 14, fontWeight: 700 }}>{l.name}</h2>
              <span style={{ fontSize: 11, ...S.sub }}>
                camere {l.rooms} · {l.bookings} prenotazioni
              </span>
            </div>

            {/* auto-fit e non auto-fill: con poche colonne auto-fill lascerebbe
                piste vuote a destra invece di allargare i gruppi esistenti.
                230px e' la larghezza sotto cui due schede affiancate iniziano a
                spezzare "Asciugatrice" a meta'. */}
            <div style={{
              display: "grid", gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))",
            }}>
              {gruppi.map((g) => (
                <div key={g.chiave} style={{ ...S.card, padding: "12px 10px 14px", minWidth: 0 }}>
                  <p style={{
                    fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                    textAlign: "center", lineHeight: 1.2, marginBottom: 10,
                  }}>{g.titolo}</p>

                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: `repeat(${g.machines.length}, minmax(0, 1fr))` }}>
                    {g.machines.map((m) => (
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
          </section>
        );
      })}
    </>
  );
}

// ─── Segnalazioni ────────────────────────────────────────────────────────────

/**
 * Estrae la macchina da una segnalazione di guasto.
 *
 * Il client la scrive come prefisso nel testo — `[GUASTO W-A] Lavatrice A
 * segnalata non funzionante — nota` (api.ts, reportBroken) — perche' la
 * tabella feedback ha una sola colonna di testo libero. Qui si smonta: il
 * codice macchina diventa un dato su cui agire, e cio' che resta e' la frase
 * che il residente ha davvero scritto.
 */
function leggiGuasto(body: string): { machine: string | null; testo: string } {
  const m = body.match(/^\[GUASTO ([WD]-[A-Z])\]\s*(.*)$/s);
  if (!m) return { machine: null, testo: body };
  // "Lavatrice A segnalata non funzionante — nota" → tiene solo la nota, se c'e':
  // la prima meta' la ripete gia' il badge della macchina.
  const resto = m[2];
  const nota = resto.split(" — ").slice(1).join(" — ").trim();
  return { machine: m[1], testo: nota };
}

// Due icone disegnate a mano invece di importare lucide-react: questo file e'
// caricato in lazy e non tira dentro quella libreria, aggiungerla per due
// glifi costerebbe piu' del disegno.
const IconaArchivia = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    <path d="M10 12h4" />
  </svg>
);

const IconaAggiorna = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 16h5v5" />
  </svg>
);

/** "3 ore fa" — in triage conta da quanto aspetta, non la data esatta. */
function quandoRelativo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1)    return "adesso";
  if (min < 60)   return `${min} min fa`;
  const ore = Math.floor(min / 60);
  if (ore < 24)   return `${ore} ${ore === 1 ? "ora" : "ore"} fa`;
  const gg = Math.floor(ore / 24);
  return `${gg} ${gg === 1 ? "giorno" : "giorni"} fa`;
}

function Segnalazioni({ laundries, reload }: { laundries: Laundry[]; reload: () => void }) {
  const [items, setItems] = useState<Feedback[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [azione, setAzione] = useState<number | null>(null);

  // Si scarica tutto una volta e si filtra qui. Cosi' il contatore su ogni
  // scheda e' gratis — ed e' quello che dice se c'e' qualcosa da fare — e
  // passare da "Da gestire" a "Tutte" non rifa' il giro in rete.
  const load = useCallback(async () => {
    setBusy(true);
    try { setItems((await call("feedback", { only_open: false, limit: 200 })).items); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function mark(f: Feedback) {
    try { await call("markFeedback", { id: f.id, handled: !f.handled }); load(); }
    catch (e: any) { alert(e.message); }
  }

  /**
   * Mette la macchina fuori servizio dalla segnalazione stessa, e nello stesso
   * gesto segna la segnalazione come gestita.
   *
   * E' l'unica cosa che l'amministratore vuole fare quando legge "Lavatrice A
   * non funziona": prima doveva leggere qui, ricordarsi la sigla, andare in
   * Macchine e ritrovarla — tre passaggi in cui si perde per strada quale
   * lavanderia fosse.
   */
  async function fuoriServizio(f: Feedback, machine: string, oos: boolean) {
    const l = laundries.find((x) => x.slug === f.laundry);
    // set_machine_status risolve la lavanderia dalla camera: quella di chi ha
    // segnalato va bene, ma una segnalazione anonima non ce l'ha — allora si
    // usa una camera qualsiasi della lavanderia giusta.
    const room = f.room || l?.sample_room;
    if (!room) { alert("Segnalazione senza lavanderia: agisci dalla scheda Macchine."); return; }

    setAzione(f.id);
    try {
      await call("setMachineStatus", { room, machine, oos });
      if (oos && !f.handled) await call("markFeedback", { id: f.id, handled: true });
      reload();   // le schede Macchine leggono lo stesso stato
      load();
    } catch (e: any) { alert(e.message); }
    finally { setAzione(null); }
  }

  const daGestire  = items.filter((f) => !f.handled);
  const archiviate = items.filter((f) => f.handled);
  const mostrati   = onlyOpen ? daGestire : archiviate;

  const Scheda = ({ attiva, onClick, label, n }: {
    attiva: boolean; onClick: () => void; label: string; n: number;
  }) => (
    <button onClick={onClick} style={{
      ...S.btn, display: "flex", alignItems: "center", gap: 7,
      ...(attiva ? { background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" } : {}),
    }}>
      {label}
      <span style={{
        fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 99,
        background: attiva ? "rgba(255,255,255,.25)" : "var(--background)",
      }}>{n}</span>
    </button>
  );

  return (
    <>
      {/* La spiegazione prima dei filtri: stava sotto, quindi si leggeva
          dopo aver gia' dovuto scegliere fra due pulsanti senza sapere
          cosa contenessero. */}
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 14, maxWidth: "70ch" }}>
        Qui arrivano le segnalazioni dei residenti, comprese quelle di guasto.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Scheda attiva={onlyOpen}  onClick={() => setOnlyOpen(true)}  label="Da gestire"  n={daGestire.length} />
        <Scheda attiva={!onlyOpen} onClick={() => setOnlyOpen(false)} label="Archiviate" n={archiviate.length} />
        {/* Solo icona: e' l'unico pulsante di questa riga che non sceglie un
            filtro, e scriverci "Aggiorna" accanto a due schede piu' grandi lo
            faceva sembrare un terzo filtro invece che un'azione a parte. */}
        <button style={{ ...S.btn, marginLeft: "auto", padding: "8px 9px", lineHeight: 0 }}
                disabled={busy} onClick={load} title="Aggiorna" aria-label="Aggiorna">
          <IconaAggiorna />
        </button>
      </div>

      {busy && items.length === 0 && <p style={{ fontSize: 13, ...S.sub }}>Caricamento…</p>}
      {!busy && mostrati.length === 0 && (
        <p style={{ fontSize: 13, ...S.sub }}>
          {onlyOpen ? "Niente da gestire: tutte le segnalazioni sono state chiuse." : "Nessuna segnalazione archiviata."}
        </p>
      )}

      {/* A griglia, non una fascia per riga.
          Su desktop ogni segnalazione occupava tutta la larghezza — 1100px per
          quattro parole — con il testo appiccicato a sinistra e il pulsante
          Archivia dall'altra parte dello schermo: per chiudere una segnalazione
          l'occhio doveva attraversare il monitor, e per confrontarne due
          bisognava scorrere. Cosi' invece stanno affiancate, si leggono come
          schede e ce ne stanno tre o quattro per riga.
          `min(100%, 340px)` tiene una colonna sola sul telefono. */}
      <div style={{
        display: "grid", gap: 10, alignItems: "start",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
      }}>
        {mostrati.map((f) => {
          const { machine, testo } = leggiGuasto(f.body);
          const l = laundries.find((x) => x.slug === f.laundry);
          const stato = machine ? l?.machines.find((m) => m.code === machine) : undefined;
          const tipo = machine?.startsWith("W") ? "Lavatrice" : "Asciugatrice";
          const inCorso = azione === f.id;

          return (
            <div key={f.id} style={{
              ...S.card, padding: "10px 12px",
              borderColor: machine && !f.handled ? "var(--destructive)" : "var(--border)",
              opacity: f.handled ? 0.6 : 1,
            }}>
              {/* Solo la camera sulla prima riga: la data serve a ordinare le
                  priorita', non a identificare la segnalazione, quindi non
                  compete per lo spazio con quello che dice DI COSA si tratta. */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                {/* Solo il numero: la lavanderia si ricava dalla camera (sotto
                    il 100 e' la Manica) e stamparla accanto era una parola in
                    piu' per riga che non aggiungeva niente. */}
                <span style={{ fontSize: 12 }}>{f.room ? `Camera ${f.room}` : "Anonimo"}</span>
              </div>
              <p style={{ fontSize: 10, marginTop: 1, marginBottom: 6, ...S.sub }}
                 title={new Date(f.created_at).toLocaleString("it-IT")}>
                {quandoRelativo(f.created_at)}
              </p>

              {/* Una segnalazione di guasto dice cosa e' rotto nella stessa
                  frase in cui lo dice, invece di un'etichetta ("Asciugatrice
                  B") separata dalla motivazione scritta sotto: chi legge non
                  deve piu' ricomporre le due parti da solo.
                  overflowWrap: il testo arriva da chi segnala, e una parola
                  lunghissima senza spazi allargherebbe la scheda oltre lo
                  schermo. */}
              {machine ? (
                <p style={{ fontSize: 13, marginBottom: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  <strong style={{ color: "var(--destructive-text)" }}>
                    {tipo} {machine.slice(-1)} segnalata come guasta{testo ? ":" : "."}
                  </strong>
                  {testo && ` ${testo}`}
                </p>
              ) : testo && (
                <p style={{ fontSize: 13, marginBottom: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{testo}</p>
              )}

              {/* I pulsanti dicono cosa si sta per decidere, non "gestisci".
                  Davanti a una segnalazione di guasto le decisioni possibili
                  sono due — la macchina e' davvero rotta, oppure no — e prima
                  erano nascoste entrambe dietro un generico "Segna come
                  gestita" che non diceva quale delle due stavi prendendo.

                  Su un messaggio che non e' un guasto resta un'azione sola:
                  li' non c'e' niente da decidere, solo da archiviare. */}
              {/* Tutte a destra, in fila.
                  Prima le decisioni sul guasto stavano a sinistra e Archivia
                  dall'altra parte: due punti da guardare per una riga sola. In
                  fondo a destra e' dove l'occhio arriva alla fine della scheda,
                  dopo aver letto di cosa si tratta — ed e' li' che si decide. */}
              <div style={{
                display: "flex", gap: 6, flexWrap: "wrap",
                alignItems: "center", justifyContent: "flex-end",
              }}>
                {machine && stato && !stato.oos && (
                  <button style={{ ...S.danger, padding: "6px 12px", fontSize: 12 }} disabled={inCorso}
                          onClick={() => fuoriServizio(f, machine, true)}>
                    Conferma guasto · fuori servizio
                  </button>
                )}
                {machine && stato?.oos && (
                  <button style={{ ...S.btn, padding: "6px 12px", fontSize: 12 }} disabled={inCorso}
                          onClick={() => fuoriServizio(f, machine, false)}>
                    Rimetti in servizio
                  </button>
                )}
                {machine && stato && !stato.oos && !f.handled && (
                  <button style={{ ...S.btn, padding: "6px 12px", fontSize: 12 }} disabled={inCorso}
                          onClick={() => mark(f)}>
                    Non è guasta
                  </button>
                )}
                {/* Archivia e' un'icona: e' l'azione che si ripete su ogni
                    scheda e non ha bisogno di rileggersi ogni volta, mentre le
                    decisioni sul guasto restano a parole perche' quelle vanno
                    lette. Riportarla indietro dall'archivio invece e' scritta
                    per esteso: la' dentro e' l'unica azione della scheda, e
                    un'icona sola in mezzo a schede sbiadite (opacity 0.6) si
                    perdeva — bisognava sapere gia' cosa significava.

                    Niente `marginLeft: auto`: spingeva l'azione all'estremita'
                    della scheda, e su desktop la scheda era larga tutto lo
                    schermo — per archiviare bisognava attraversare il monitor.
                    Sta accanto alle altre azioni, dove si guarda gia'. */}
                {f.handled ? (
                  <button style={{ ...S.btn, padding: "6px 12px", fontSize: 12 }}
                          disabled={inCorso} onClick={() => mark(f)}>
                    Riporta a Da gestire
                  </button>
                ) : (
                  <button
                    style={{ ...S.btn, padding: "6px 9px", lineHeight: 0 }}
                    disabled={inCorso} onClick={() => mark(f)}
                    title="Archivia" aria-label="Archivia">
                    <IconaArchivia />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Regole ricorrenti (sistemista) ──────────────────────────────────────────
//
// Una regola non è una prenotazione: è la ricetta con cui, una volta alla
// settimana (la notte fra domenica e lunedì), le prenotazioni della settimana
// che sta per iniziare vengono create. Una regola creata a metà settimana non
// tocca quella in corso: vale dal lunedì successivo. Cancellare la regola non
// cancella le prenotazioni già scritte — quelle restano fino a fine settimana
// e si tolgono dalla scheda Prenotazioni.

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
      setMsg(r.ok ? "Regola creata. Vale dal lunedì prossimo." : r.error);
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
      setMsg("Regola creata. Vale dal lunedì prossimo.");
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

  // Solo lavatrici: una regola ricorrente di lavanderia prenota sempre una
  // lavatrice, mai un'asciugatrice (quella si deriva da sola, come nelle
  // prenotazioni normali). Senza questo filtro il menu offriva anche D-A/B/C
  // — sceglierne una creava comunque la regola, ma la prenotazione che ne
  // usciva non compariva mai nella griglia, che le asciugatrici non le
  // legge da laundry_booking.
  const machines = laundries.find((l) => l.id === lid)?.machines
    .filter((m) => m.bookable && m.kind === "washer") ?? [];
  const roomsHint = laundries.find((l) => l.id === lid)?.rooms;

  return (
    <>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 16 }}>
        Le regole vengono applicate una volta alla settimana, la notte fra domenica e lunedì,
        alla settimana che inizia. Una regola creata adesso non tocca quella in corso: vale dal
        lunedì successivo. Cancellare una regola <strong>non</strong> cancella le prenotazioni
        già create: quelle restano fino a fine settimana.
      </p>

      {msg && (
        <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>
      )}

      {/* Nuova regola lavanderia */}
      <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Nuova regola · lavanderia</h2>
        <div className="adm-form">
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
          {/* Il numero ricorda a quale lavanderia appartiene la camera scelta
              sopra: scrivere "215" per la Manica (camere 1-99) creava una
              regola che si applicava alla Manica ma che nessuno, guardando la
              camera 215 (Valentino), avrebbe mai visto. */}
          <input style={S.input} placeholder={roomsHint ? `Camera (${roomsHint})` : "Camera"}
                 value={room} onChange={(e) => setRoom(e.target.value)} />
          <button style={{ ...S.btn, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" }}
                  disabled={busy} onClick={addLaundry}>Aggiungi</button>
        </div>
      </div>

      {/* Nuova regola sala */}
      <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Nuova regola · sala</h2>
        <div className="adm-form">
          <select style={S.input} value={space} onChange={(e) => setSpace(e.target.value as any)}>
            <option value="cinema">Cinema</option>
            <option value="music">Musica</option>
          </select>
          <select style={S.input} value={sDay} onChange={(e) => setSDay(Number(e.target.value))}>
            {DAYS.map((d, i) => <option key={i} value={i}>Ogni {d.toLowerCase()}</option>)}
          </select>
          {/* Ruote anche qui, per lo stesso motivo del modulo polivalente:
              il pannello nativo su alcuni telefoni finisce fuori schermo. */}
          <RuotaOrario valore={sStart} onCambia={setSStart} etichetta="Inizio" />
          <RuotaOrario valore={sEnd}   onCambia={setSEnd}   etichetta="Fine" />
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
            <div key={r.id} className="adm-rule" style={{ opacity: r.active ? 1 : 0.5 }}>
              <span style={{ fontSize: 11, fontWeight: 700, ...S.sub }}>
                {r.kind === "laundry" ? "LAVANDERIA" : "SALA"}
              </span>
              <span style={{ fontSize: 13 }}>ogni {DAYS[r.day].toLowerCase()}</span>
              <span className="adm-rule__what">
                {r.kind === "laundry"
                  ? `${slotLabel(r.slot!)} · ${r.machine} · camera ${r.room}`
                  : `${r.space} · ${timeLabel(r.start!)}–${timeLabel(r.end!)} · ${r.name}`}
              </span>
              <span className="adm-rule__act">
                <button style={S.btn} onClick={() => toggle(r)}>{r.active ? "Sospendi" : "Riattiva"}</button>
                <button style={S.danger} onClick={() => remove(r)}>Elimina</button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Sala polivalente — foglio del giorno (lato admin) ──────────────────────
//
// Aperto da Conferenze.tsx quando un admin tocca un giorno sul calendario:
// l'elenco degli eventi di quel giorno con "Elimina", e un modulo per
// aggiungerne uno nuovo. Ogni evento e' una riga a sé nel database (un
// giorno solo): qui non si scrivono più "regole" astratte ("ogni martedì
// dal 7 ottobre al 30 maggio") — si programma un giorno alla volta,
// cliccando sul calendario. Un errore nel giorno della settimana di una
// regola poteva renderla silenziosamente inutile (vedi migrazione 010):
// un giorno solo non lascia spazio a quell'ambiguità.
/** "sab 7 ott 2026" — il giorno della settimana aiuta a leggere una data
 *  isolata come parte di un calendario invece che come un numero. */
const dataBreve = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("it-IT",
    { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export function GiornoSheetAdmin({ data, eventi, onCambiato }: {
  // onCambiato NON riceve l'agenda tornata dalla scrittura: le funzioni SQL
  // rispondono con una finestra di 60 giorni, che non e' per forza quella che
  // il chiamante sta mostrando. Ricarica lui la sua.
  data: string; eventi: Occorrenza[]; onCambiato: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // Quale "Elimina" mostra il proprio stato di attesa: con un solo stato
  // condiviso, cancellare un evento faceva sembrare in corso anche gli altri
  // pulsanti della stessa lista.
  const [eliminando, setEliminando] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // L'evento che si sta modificando, se ce n'e' uno. Quando e' valorizzato il
  // modulo qui sotto cambia mestiere: stesso form, "Salva" invece di
  // "Aggiungi", e la selezione multipla dei giorni sparisce — una riga del
  // database e' UNA cadenza, e spalmarla su piu' giorni modificandola
  // vorrebbe dire crearne altre, che non e' quello che chiede chi ha premuto
  // "Modifica".
  const [modifica, setModifica] = useState<Occorrenza | null>(null);
  // Se la modifica riguarda solo QUESTO incontro o tutta la serie. La
  // distinzione e' l'intero punto delle eccezioni: senza, chi vuole spostare
  // un sabato di festa sposterebbe il corso di tutto l'anno.
  const [ambito, setAmbito] = useState<"serie" | "occorrenza">("serie");
  // L'occorrenza su cui si sta chiedendo "questo o tutti?", con l'azione che
  // ha fatto scattare la domanda.
  const [chiede, setChiede] = useState<{ o: Occorrenza; azione: "modifica" | "elimina" } | null>(null);

  const [titolo, setTitolo] = useState("");
  const [inizio, setInizio] = useState("14:00");
  const [fine, setFine] = useState("18:00");
  const [note, setNote] = useState("");
  const [dal, setDal] = useState(data);

  // Ricorrenza. Il database la sa gia' rappresentare: una riga con
  // giorno_settimana valorizzato e un intervallo dal-al e' "ogni martedi' dal…
  // al…", espansa in lettura da conference_agenda.
  const [ripete, setRipete] = useState<"mai" | "settimane" | "finoA">("mai");
  const [nSettimane, setNSettimane] = useState(8);
  const [finoA, setFinoA] = useState(data);

  // 0 = lunedi' … 6 = domenica, come giorno_settimana in tabella.
  const giornoDi = (iso: string) => (new Date(iso + "T00:00:00").getDay() + 6) % 7;
  const piuGiorni = (iso: string, n: number) => {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString("sv-SE");
  };

  // I giorni della settimana su cui ripetere. Piu' d'uno serve al caso PFP —
  // "il martedi' e il giovedi'" — che altrimenti obbligava a compilare il
  // modulo due volte. Ognuno diventa una riga a se': restano cosi'
  // modificabili e cancellabili separatamente, e il controllo delle
  // sovrapposizioni continua a ragionare su una cadenza per volta.
  const [giorni, setGiorni] = useState<number[]>([giornoDi(data)]);
  const alternaGiorno = (g: number) =>
    setGiorni((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g].sort()));

  /** La prima data successiva o uguale a daISO che cade nel giorno g. */
  function primaOccorrenza(daISO: string, g: number) {
    return piuGiorni(daISO, (g - giornoDi(daISO) + 7) % 7);
  }

  function pulisci() {
    setModifica(null); setAmbito("serie"); setChiede(null);
    setTitolo(""); setNote("");
    setInizio("14:00"); setFine("18:00");
    setDal(data); setRipete("mai"); setNSettimane(8); setFinoA(data);
    setGiorni([giornoDi(data)]);
  }

  /** Apre il modulo gia' compilato con cio' che l'evento e' adesso. */
  function apriModifica(o: Occorrenza, quale: "serie" | "occorrenza") {
    setModifica(o);
    setAmbito(quale);
    setChiede(null);
    setMsg(null);
    setTitolo(o.titolo);
    setInizio(o.inizio);
    setFine(o.fine);
    setNote(o.note ?? "");
    if (quale === "occorrenza") {
      // Un solo incontro: si sposta una data, non si tocca la cadenza. Il
      // modulo si riduce a titolo, orari e giorno.
      setDal(o.data);
      setRipete("mai");
      return;
    }
    const d = o.dal ?? o.data;
    const a = o.al ?? o.data;
    setDal(d);
    setFinoA(a);
    setRipete(a === d ? "mai" : "finoA");
    setGiorni([o.giorno ?? giornoDi(d)]);
  }

  /** Un'azione su un'occorrenza: se la serie si ripete, prima si chiede. */
  function chiediAmbito(o: Occorrenza, azione: "modifica" | "elimina") {
    if (!o.ricorrente) {
      // Evento singolo: non c'e' niente da distinguere.
      if (azione === "modifica") apriModifica(o, "serie");
      else elimina(o, "serie");
      return;
    }
    setChiede({ o, azione });
    setMsg(null);
  }

  /** Rimette un incontro spostato o modificato come lo vuole la regola. */
  async function ripristina(o: Occorrenza) {
    setBusy(true); setMsg(null);
    try {
      await call("conferenzaResetOccorrenza", { id: o.id, data: o.data_regola ?? o.data });
      await onCambiato();
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  /** Messaggio d'errore leggibile, con la data del primo scontro se c'e'. */
  function spiegaErrore(e: any) {
    if (e.message !== "sovrapposto") return e.message;
    const quando = e.quando ? " (primo scontro: " + dataBreve(e.quando) + ")" : "";
    return 'Si sovrappone a "' + (e.con ?? "un evento") + '" in questo orario' + quando + ".";
  }

  async function salva() {
    if (!titolo.trim()) { setMsg("Indica un titolo."); return; }

    // ── Modifica di UN SOLO incontro: diventa un'eccezione alla serie ──────
    if (modifica && ambito === "occorrenza") {
      setBusy(true); setMsg(null);
      try {
        await call("conferenzaMove", {
          id: modifica.id,
          // La data che la REGOLA produce, non quella a cui si vede: e' il
          // nome dell'incontro, e resta lo stesso anche spostandolo di nuovo.
          data: modifica.data_regola ?? modifica.data,
          nuova_data: dal,
          inizio, fine,
          titolo: titolo.trim(),
          note: note.trim() || null,
        });
        await onCambiato();
        pulisci();
      } catch (e: any) { setMsg(spiegaErrore(e)); }
      finally { setBusy(false); }
      return;
    }

    // ── Modifica dell'intera serie ────────────────────────────────────────
    if (modifica) {
      const g = giorni[0] ?? giornoDi(dal);
      const al = ripete === "mai" ? dal
               : ripete === "settimane" ? piuGiorni(dal, (Math.max(1, nSettimane) - 1) * 7)
               : finoA;
      if (al < dal) { setMsg("La data di fine è prima di quella di inizio."); return; }
      setBusy(true); setMsg(null);
      try {
        await call("conferenzaUpdate", {
          id: modifica.id, titolo: titolo.trim(), inizio, fine,
          dal, al, giorno: al === dal ? null : g,
          note: note.trim() || null,
        });
        await onCambiato();
        pulisci();
      } catch (e: any) { setMsg(spiegaErrore(e)); }
      finally { setBusy(false); }
      return;
    }

    // ── Creazione: un evento singolo, oppure una regola per giorno scelto ──
    if (ripete === "mai") {
      setBusy(true); setMsg(null);
      try {
        await call("conferenzaAdd", {
          titolo: titolo.trim(), inizio, fine, dal: data, al: data,
          giorno: null, note: note.trim() || null,
        });
        await onCambiato();
        pulisci();
      } catch (e: any) { setMsg(spiegaErrore(e)); }
      finally { setBusy(false); }
      return;
    }

    if (giorni.length === 0) { setMsg("Scegli almeno un giorno della settimana."); return; }

    // Una regola per giorno: ognuna parte dalla prima occorrenza di QUEL
    // giorno a partire da oggi, non dal giorno cliccato — scegliendo
    // "martedi'" da un sabato, la serie deve cominciare il martedi' dopo.
    setBusy(true); setMsg(null);
    let creati = 0;
    const scartati: string[] = [];
    for (const g of giorni) {
      const d = primaOccorrenza(data, g);
      const al = ripete === "settimane"
        ? piuGiorni(d, (Math.max(1, nSettimane) - 1) * 7)
        : finoA;
      if (al < d) { scartati.push(DAYS[g] + " (la data di fine è prima dell'inizio)"); continue; }
      try {
        await call("conferenzaAdd", {
          titolo: titolo.trim(), inizio, fine, dal: d, al,
          giorno: al === d ? null : g,
          note: note.trim() || null,
        });
        creati++;
      } catch (e: any) {
        scartati.push(DAYS[g] + ": " + spiegaErrore(e));
      }
    }
    setBusy(false);

    // Ogni giorno e' indipendente: se il martedi' va a sbattere contro un
    // altro corso, il giovedi' viene creato comunque e si dice solo quale e'
    // saltato — invece di annullare tutto e far ricominciare da capo.
    if (scartati.length === 0) {
      setMsg(null);
      pulisci();
    } else {
      setMsg(creati + " creat" + (creati === 1 ? "a" : "e") + ", "
           + scartati.length + " saltat" + (scartati.length === 1 ? "a" : "e")
           + " — " + scartati.join(" · "));
    }
    if (creati > 0) await onCambiato();
  }

  /**
   * Toglie un incontro solo ('occorrenza', diventa un'eccezione 'annullata')
   * oppure l'intera serie ('serie', cancella la regola). La scelta la fa
   * chiediAmbito qui sopra: qui non si indovina mai.
   */
  async function elimina(o: Occorrenza, quale: "serie" | "occorrenza") {
    setChiede(null);
    setBusy(true); setEliminando(o.id); setMsg(null);
    try {
      if (quale === "occorrenza") {
        await call("conferenzaSkip", { id: o.id, data: o.data_regola ?? o.data });
      } else {
        await call("conferenzaDelete", { id: o.id });
      }
      await onCambiato();
      if (modifica?.id === o.id) pulisci();
    }
    catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); setEliminando(null); }
  }

  const baseFine = modifica ? dal : primaOccorrenza(data, giorni[0] ?? giornoDi(data));
  const etichettaFine = ripete === "settimane"
    ? piuGiorni(baseFine, (Math.max(1, nSettimane) - 1) * 7)
    : finoA;

  return (
    <>
      {msg && <div style={{ ...S.card, padding: 10, marginBottom: 12, fontSize: 13 }}>{msg}</div>}

      {eventi.length === 0 ? (
        <p style={{ fontSize: 13, ...S.sub, marginBottom: 14 }}>Nessun evento in programma.</p>
      ) : (
        <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
          {eventi.map((o) => (
            <div key={o.id}>
              <div className="adm-rule"
                   style={modifica?.id === o.id
                     ? { borderColor: "var(--primary)", background: "color-mix(in srgb, var(--primary) 8%, transparent)" }
                     : undefined}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{o.inizio}–{o.fine}</span>
                <span className="adm-rule__what">
                  {o.titolo}
                  {o.ricorrente && (
                    <span style={{ display: "block", fontSize: 12, ...S.sub }}>
                      Si ripete ogni settimana
                      {o.spostata && " · questo incontro è stato modificato"}
                    </span>
                  )}
                  {o.note && <span style={{ display: "block", fontSize: 12, ...S.sub }}>{o.note}</span>}
                </span>
                <span className="adm-rule__act">
                  <button style={S.btn} disabled={busy} onClick={() => chiediAmbito(o, "modifica")}>
                    {modifica?.id === o.id ? "In modifica" : "Modifica"}
                  </button>
                  <button style={S.danger} disabled={busy} onClick={() => chiediAmbito(o, "elimina")}>
                    {eliminando === o.id ? "Elimino…" : "Elimina"}
                  </button>
                </span>
              </div>

              {/* La domanda che rende sicure le serie ricorrenti. Senza,
                  "Elimina" su un sabato di festa cancellava il corso di tutto
                  l'anno: la riga mostra UN incontro, ma il pulsante agiva
                  sulla regola che li genera tutti. */}
              {chiede?.o.id === o.id && chiede.o.data === o.data && (
                <div style={{ ...S.card, padding: 10, marginTop: 6, display: "grid", gap: 8 }}>
                  <p style={{ fontSize: 13 }}>
                    {chiede.azione === "elimina" ? "Che cosa vuoi eliminare?" : "Che cosa vuoi modificare?"}
                  </p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button style={{ ...S.btn, fontSize: 12 }} disabled={busy}
                            onClick={() => chiede.azione === "elimina"
                              ? elimina(o, "occorrenza")
                              : apriModifica(o, "occorrenza")}>
                      Solo {dataBreve(o.data)}
                    </button>
                    <button style={{ ...(chiede.azione === "elimina" ? S.danger : S.btn), fontSize: 12 }}
                            disabled={busy}
                            onClick={() => chiede.azione === "elimina"
                              ? elimina(o, "serie")
                              : apriModifica(o, "serie")}>
                      Tutta la serie
                    </button>
                    <button style={{ ...S.btn, fontSize: 12 }} onClick={() => setChiede(null)}>Annulla</button>
                  </div>
                </div>
              )}

              {/* Un incontro gia' scostato dalla regola si puo' riallineare. */}
              {o.spostata && chiede?.o.id !== o.id && (
                <button style={{ ...S.btn, fontSize: 12, marginTop: 6 }} disabled={busy}
                        onClick={() => ripristina(o)}>
                  Rimetti come la serie
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Linea netta fra "cosa c'e' gia'" e "cosa sto per fare". */}
      <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0 16px" }} />

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <p style={{ fontSize: 12, fontWeight: 700, ...S.sub, flex: 1 }}>
          {!modifica ? "AGGIUNGI EVENTO"
            : ambito === "occorrenza" ? "MODIFICA SOLO QUESTO INCONTRO"
            : "MODIFICA TUTTA LA SERIE"}
        </p>
        {modifica && (
          <button style={{ ...S.btn, padding: "4px 10px", fontSize: 12 }} onClick={pulisci}>Annulla</button>
        )}
      </div>

      <input style={{ ...S.input, marginBottom: 8 }} placeholder="Titolo (es. Corsi PFP)" value={titolo}
             maxLength={60} onChange={(e) => setTitolo(e.target.value)} />

      {/* Ruote al posto di <input type="time">: il pannello di sistema di
          quell'input, su alcuni telefoni, si apre oltre il bordo inferiore e
          resta invisibile. Le ruote sono HTML nostro e vivono dentro il
          modale, quindi non possono uscirne. Inizio e fine restano affiancati
          per leggersi come un intervallo. */}
      <div className="conf-incontro__orari" style={{ marginBottom: 8 }}>
        <RuotaOrario valore={inizio} onCambia={setInizio} etichetta="Orario di inizio" />
        <RuotaOrario valore={fine}   onCambia={setFine}   etichetta="Orario di fine" />
      </div>

      {/* In modifica la data si puo' spostare: e' il "cambia giorno". In
          creazione e' il giorno che si e' toccato sul calendario. */}
      {modifica && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>
            {ambito === "occorrenza" ? "Sposta al giorno"
              : ripete === "mai" ? "Giorno" : "A partire dal"}
          </label>
          <input style={S.input} type="date" value={dal} onChange={(e) => setDal(e.target.value)} />
        </div>
      )}

      {ambito !== "occorrenza" && (<>
      <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>Si ripete</label>
      <select style={{ ...S.input, marginBottom: 8 }} value={ripete}
              onChange={(e) => setRipete(e.target.value as typeof ripete)}>
        <option value="mai">Una volta sola</option>
        <option value="settimane">Ogni settimana, per N settimane</option>
        <option value="finoA">Ogni settimana, fino a una data</option>
      </select>

      {ripete !== "mai" && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>
            {modifica ? "In che giorno" : "In che giorni (se ne possono scegliere più d'uno)"}
          </label>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {DAYS.map((d, g) => {
              const scelto = giorni.includes(g);
              return (
                <button key={g} type="button"
                        onClick={() => (modifica ? setGiorni([g]) : alternaGiorno(g))}
                        style={{
                          ...S.btn, padding: "6px 10px", fontSize: 12, minWidth: 44,
                          ...(scelto ? { background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" } : {}),
                        }}>
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {ripete === "settimane" && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>Quante settimane</label>
          <input style={S.input} type="number" min={1} max={57} value={nSettimane}
                 onChange={(e) => setNSettimane(Number(e.target.value))} />
          <p style={{ fontSize: 12, ...S.sub, marginTop: 4 }}>Ultima volta: {dataBreve(etichettaFine)}</p>
        </div>
      )}

      {ripete === "finoA" && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>Fino al</label>
          <input style={S.input} type="date" value={finoA} min={modifica ? dal : data}
                 onChange={(e) => setFinoA(e.target.value)} />
        </div>
      )}
      </>)}

      {ambito === "occorrenza" && (
        <p style={{ fontSize: 12, ...S.sub, marginBottom: 8 }}>
          Cambia solo questo incontro. La serie resta com'è, e questo giorno
          diventa un'eccezione che si può sempre rimettere in riga.
        </p>
      )}

      <input style={{ ...S.input, marginBottom: 12 }} placeholder="Note (facoltative)" value={note}
             maxLength={300} onChange={(e) => setNote(e.target.value)} />

      <button className="azione-fissa"
              style={{ ...S.btn, width: "100%", background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" }}
              disabled={busy} onClick={salva}>
        {busy && eliminando === null
          ? (modifica ? "Salvo…" : "Aggiungo…")
          : (modifica ? "Salva modifiche" : "Aggiungi evento")}
      </button>
    </>
  );
}

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
];

const etichettaData = (iso: string) =>
  new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });

function Accounts({ me }: { me: string | null }) {
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

// Una riga per dispositivo (push) o per chat (Telegram) collegati: l'id
// serve a poterla togliere singolarmente, non solo a contarla.
type IscrizioneRiga = { id: number; laundry: string; room: string };
type PushSubs = { camere_totali: number; dispositivi_totali: number; iscrizioni: IscrizioneRiga[] };
type TelegramSubs = { camere_totali: number; chat_totali: number; iscrizioni: IscrizioneRiga[] };

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

/** Quali camere hanno le notifiche attive su un canale, con un modo di
 *  togliere una riga sola.
 *
 *  Non e' un contatore che deve tornare a zero come quello delle
 *  prenotazioni: e' solo una fotografia, per sapere quanto e' diffusa la
 *  funzione senza doverlo chiedere in giro — e per poter chiudere l'unica
 *  iscrizione di chi ha lasciato la residenza, senza azzerarle tutte con la
 *  pulizia qui sotto. Condivisa fra push e Telegram: sono la stessa lista,
 *  solo con le colonne di riepilogo diverse. */
function ListaIscrizioni({ titolo, riepilogo, righe, vuoto, onDelete }: {
  titolo: string; riepilogo: string | null; righe: IscrizioneRiga[] | null;
  vuoto: string; onDelete: (id: number) => void;
}) {
  return (
    <div style={{ ...S.card, padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", ...S.sub }}>
          {titolo}
        </p>
        <span style={{ fontSize: 12, ...S.sub, fontVariantNumeric: "tabular-nums" }}>
          {riepilogo ?? "—"}
        </span>
      </div>

      {righe && righe.length === 0 && (
        <p style={{ fontSize: 13, ...S.sub }}>{vuoto}</p>
      )}

      {righe && righe.length > 0 && (
        <div style={{ display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }}>
          {righe.map((r) => (
            <div key={r.id}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 10, background: "var(--secondary)" }}>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{r.room}</span>
              <span style={{ fontSize: 11, ...S.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.laundry}</span>
              <button onClick={() => onDelete(r.id)} style={{ ...S.danger, padding: "4px 10px", fontSize: 11, flexShrink: 0 }}>
                Elimina
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Manutenzione() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [chiesto, setChiesto] = useState<string | null>(null);   // ambito in attesa di conferma
  const [parola, setParola] = useState("");
  const [sala, setSala] = useState<SalaId | null>(null);         // null = tutte le sale
  const [conteggi, setConteggi] = useState<Conteggi | null>(null);
  const [scaduto, setScaduto] = useState(false);
  const [pushSubs, setPushSubs] = useState<PushSubs | null>(null);
  const [telegramSubs, setTelegramSubs] = useState<TelegramSubs | null>(null);

  const aggiorna = useCallback(async () => {
    try { setConteggi(await call<Conteggi>("counts")); setScaduto(false); }
    catch { setScaduto(true); }   // il contatore non e' l'operazione: non blocca niente
    try { setPushSubs(await call<PushSubs>("pushSubs")); } catch { /* stessa logica: solo una fotografia */ }
    try { setTelegramSubs(await call<TelegramSubs>("telegramSubs")); } catch { /* idem */ }
  }, []);

  async function eliminaPush(id: number) {
    if (!confirm("Togliere questa iscrizione alle notifiche push?\n\nIl dispositivo smetterà di ricevere promemoria finché non le riattiva da solo.")) return;
    try { await call("deletePushSub", { id }); aggiorna(); }
    catch (e: any) { setMsg(e.message); }
  }

  async function eliminaTelegram(id: number) {
    if (!confirm("Scollegare questa chat Telegram?\n\nChi la usa smetterà di ricevere promemoria finché non la ricollega da solo.")) return;
    try { await call("deleteTelegramSub", { id }); aggiorna(); }
    catch (e: any) { setMsg(e.message); }
  }

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
      <ListaIscrizioni
        titolo="Notifiche push (web app)"
        riepilogo={pushSubs ? `${pushSubs.camere_totali} camere · ${pushSubs.dispositivi_totali} dispositivi` : null}
        righe={pushSubs?.iscrizioni ?? null}
        vuoto="Nessun dispositivo ha le notifiche push attive."
        onDelete={eliminaPush}
      />
      <ListaIscrizioni
        titolo="Notifiche Telegram"
        riepilogo={telegramSubs ? `${telegramSubs.camere_totali} camere · ${telegramSubs.chat_totali} chat` : null}
        righe={telegramSubs?.iscrizioni ?? null}
        vuoto="Nessuna chat Telegram collegata."
        onDelete={eliminaTelegram}
      />

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
  onSession: (role: Role | null) => void;
}) {
  function done() {
    fetch("/api/admin/auth")
      .then((r) => r.json())
      .then((d) => { onSession(d.logged ? (d.role as Role) : null); onClose(); })
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

// ─── Sezione amministrativa ──────────────────────────────────────────────────
//
// Non e' piu' una pagina a se' ne' un pannello sovrapposto: e' una destinazione
// della navigazione, allo stesso livello di Lavanderia, Cinema e Musica. Un
// amministratore usa esattamente la stessa app di tutti gli altri e trova
// qualche voce in piu' nella lista di sinistra.
//
// La barra del ruolo con "Esci" sta qui dentro, su ogni sezione: chi deve
// passare da FDO a sistemista lo fa da dove sta gia' lavorando, senza andare a
// cercare il menu.

export function AdminScreens({ tab, onSession }: {
  tab: Tab;
  onSession: (role: Role | null) => void;   // per riallineare l'app dopo logout o scadenza
}) {
  const [logged, setLogged] = useState<boolean | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [deveCambiare, setDeveCambiare] = useState(false);
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
        setUsername(d.user || null);
        setDeveCambiare(Boolean(d.deve_cambiare_password));
        onSession(d.logged ? (d.role as Role) : null);
      })
      .catch(() => { setLogged(false); onSession(null); });
  }, [onSession]);

  useEffect(() => { refreshSession(); }, [refreshSession]);
  // Lo staff non vede Macchine ne' Segnalazioni — le uniche schede che usano
  // `laundries` — quindi per lui questa chiamata fallirebbe soltanto (il
  // server la rifiuta, vedi VIETATE_A_STAFF in api/admin/data.js) senza
  // nessun beneficio.
  useEffect(() => { if (logged && role !== "staff") loadOverview(); }, [logged, role, loadOverview]);

  // L'uscita non sta piu' qui: la fa il pulsante della camera nell'app, che
  // chiude la sessione e riporta al selettore della stanza. `adminLogout()`
  // resta esportato ed e' quello che App.tsx chiama.

  const sistemista = role === "sistemista";
  const staff = role === "staff";

  if (logged === null) {
    return <p style={{ fontSize: 13, ...S.sub, padding: "20px 4px" }}>Caricamento…</p>;
  }

  // Sessione assente o scaduta mentre si stava lavorando: il login compare qui,
  // dove si era, invece di rimbalzare l'utente altrove senza spiegazioni.
  if (!logged) {
    return (
      <div style={{ padding: "20px 0 40px" }}>
        <p style={{ fontSize: 13, ...S.sub, marginBottom: 14, textAlign: "center" }}>
          La sessione amministrativa non è attiva.
        </p>
        <Login onDone={refreshSession} />
      </div>
    );
  }

  // Un account appena creato (o con la password appena reimpostata) non puo'
  // fare nient'altro finche' non sceglie una password sua: qui la sala
  // d'attesa sostituisce QUALUNQUE scheda, a prescindere da quale sia stata
  // scelta in navigazione — altrimenti bastava restare su Macchine per
  // rimandare la scelta all'infinito.
  if (deveCambiare) {
    return (
      <div style={{ paddingBottom: 40, color: "var(--foreground)" }}>
        <CambiaPasswordObbligata onFatto={refreshSession} />
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 40, color: "var(--foreground)" }}>
      {/* Qui c'era una barra col ruolo e il pulsante Esci. Tolta: l'uscita
          avviene toccando il pulsante della camera ("DIREZIONE") in alto, che
          chiude la sessione e riporta alla scelta della stanza. Un secondo
          punto d'uscita, ripetuto su ogni sezione, faceva solo rumore sopra il
          contenuto — e il ruolo si capisce gia' da quali voci si vedono in
          navigazione (Ricorrenti e Manutenzione solo da sistemista). */}

      {/* Le sezioni riservate al sistemista (o escluse per lo staff) non
          compaiono nemmeno nella navigazione, ma se ci si arriva lo stesso
          il controllo vero resta sul server: nascondere una voce non e'
          un'autorizzazione. */}
      {tab === "macchine" && (!staff
        ? <Macchine laundries={laundries} reload={loadOverview} />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata a FDO e sistemista.</p>)}
      {tab === "segnalazioni" && (!staff
        ? <Segnalazioni laundries={laundries} reload={loadOverview} />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata a FDO e sistemista.</p>)}
      {tab === "account" && (sistemista
        ? <Accounts me={username} />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata al sistemista.</p>)}
      {tab === "ricorrenti" && (sistemista
        ? laundries.length > 0 && <Ricorrenti laundries={laundries} />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata al sistemista.</p>)}
      {tab === "manutenzione" && (sistemista
        ? <Manutenzione />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata al sistemista.</p>)}
    </div>
  );
}
