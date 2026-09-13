import { useCallback, useEffect, useState } from "react";
import { Shirt, Film, Music } from "lucide-react";
import { RuotaOrario } from "../../../RuotaPicker";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";
import { DAYS } from "../../admin-shared/adminHelpers";
import type { Laundry } from "../../laundry/admin/types";

type Recurring = {
  id: number; kind: "laundry" | "space"; day: number; active: boolean; note?: string;
  laundry?: string; laundry_id?: number; slot?: number; machine?: string; room?: string;
  space?: string; space_id?: number; start?: number; end?: number; name?: string; type?: string;
};

const slotLabel = (s: number) => {
  const m = 420 + s * 75;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(m / 60) % 24)}:${p(m % 60)}`;
};
const timeLabel = (m: number) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(m / 60) % 24)}:${p(m % 60)}`;
};

// ─── Regole ricorrenti (sistemista) ──────────────────────────────────────────
//
// Una regola non è una prenotazione: è la ricetta con cui, una volta alla
// settimana (la notte fra domenica e lunedì), le prenotazioni della settimana
// che sta per iniziare vengono create. Una regola creata a metà settimana non
// tocca quella in corso: vale dal lunedì successivo. Cancellare la regola non
// cancella le prenotazioni già scritte — quelle restano fino a fine settimana
// e si tolgono dalla scheda Prenotazioni.

export function Ricorrenti({ laundries }: { laundries: Laundry[] }) {
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

      {/* Nuova regola lavanderia.
          Ogni campo ha un'etichetta propria e i cinque vanno a coppie su due
          colonne: prima erano select nude una sotto l'altra, senza dire cosa
          fosse cosa ("07:00" e "W-A" si leggono solo dal contesto) e alte
          quanto un modulo di sei righe per cinque scelte. */}
      <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Nuova regola · lavanderia</h2>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>Lavanderia</label>
              <select style={S.input} value={lid} onChange={(e) => setLid(Number(e.target.value))}>
                {laundries.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>Ripeti</label>
              <select style={S.input} value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {DAYS.map((d, i) => <option key={i} value={i}>Ogni {d.toLowerCase()}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>Orario</label>
              <select style={S.input} value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
                {Array.from({ length: 19 }, (_, i) => <option key={i} value={i}>{slotLabel(i)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>Macchina</label>
              <select style={S.input} value={machine} onChange={(e) => setMachine(e.target.value)}>
                {machines.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}
              </select>
            </div>
          </div>
          <div>
            {/* Il numero ricorda a quale lavanderia appartiene la camera scelta
                sopra: scrivere "215" per la Manica (camere 1-99) creava una
                regola che si applicava alla Manica ma che nessuno, guardando la
                camera 215 (Valentino), avrebbe mai visto. */}
            <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>Camera</label>
            <input style={S.input} placeholder={roomsHint ? `es. ${roomsHint}` : "Camera"}
                   value={room} onChange={(e) => setRoom(e.target.value)} />
          </div>
          <button style={{ ...S.btn, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent" }}
                  disabled={busy} onClick={addLaundry}>Aggiungi</button>
        </div>
      </div>

      {/* Nuova regola sala */}
      <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Nuova regola · sala</h2>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>Sala</label>
              <select style={S.input} value={space} onChange={(e) => setSpace(e.target.value as any)}>
                <option value="cinema">Cinema</option>
                <option value="music">Musica</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>Ripeti</label>
              <select style={S.input} value={sDay} onChange={(e) => setSDay(Number(e.target.value))}>
                {DAYS.map((d, i) => <option key={i} value={i}>Ogni {d.toLowerCase()}</option>)}
              </select>
            </div>
          </div>
          {/* Ruote anche qui, per lo stesso motivo del modulo polivalente: il
              pannello nativo su alcuni telefoni finisce fuori schermo. La
              classe è la stessa di Conferenze.tsx, per lo stesso motivo:
              inizio e fine affiancati si leggono come un intervallo, uno
              sotto l'altro si leggono come due numeri scollegati. */}
          <div className="conf-incontro__orari">
            <RuotaOrario valore={sStart} onCambia={setSStart} etichetta="Inizio" />
            <RuotaOrario valore={sEnd}   onCambia={setSEnd}   etichetta="Fine" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, ...S.sub, marginBottom: 4 }}>Nome</label>
            <input style={S.input} placeholder="es. Serata cinema" value={sName} onChange={(e) => setSName(e.target.value)} />
          </div>
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
              {/* L'icona aiuta a distinguere le regole scorrendo l'elenco a
                  colpo d'occhio, invece di dover leggere l'etichetta di ogni
                  riga una per una. */}
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, ...S.sub }}>
                {r.kind === "laundry"
                  ? <Shirt size={12} />
                  : r.space?.toLowerCase().startsWith("cine") ? <Film size={12} /> : <Music size={12} />}
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
