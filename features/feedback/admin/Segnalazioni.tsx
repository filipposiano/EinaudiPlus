import { useCallback, useEffect, useState } from "react";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";
import type { Laundry } from "../../laundry/admin/types";

type Feedback = { id: number; room: string | null; body: string; laundry: string | null; created_at: string; handled: boolean };

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

export function Segnalazioni({ laundries, reload }: { laundries: Laundry[]; reload: () => void }) {
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
