import { useState } from "react";
import type { Occorrenza } from "../../../conferenzeApi";
import { RuotaOrario } from "../../../RuotaPicker";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";
import { DAYS } from "../../admin-shared/adminHelpers";

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
