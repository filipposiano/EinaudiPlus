import { useState } from "react";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";
import type { Machine, Laundry } from "./types";

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

export function Macchine({ laundries, reload }: { laundries: Laundry[]; reload: () => void }) {
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
