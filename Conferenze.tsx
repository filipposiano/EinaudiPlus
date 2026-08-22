// Conferenze.tsx — la sala polivalente, come un calendario.
//
// A differenza di cinema e musica qui i residenti non prenotano: la sala la
// programma la direzione. In cima, la risposta alla domanda con cui si apre
// questa pagina — **è libera adesso?** — e sotto un calendario mensile: ogni
// giorno con un impegno ha un puntino, si tocca il giorno per vederne i
// dettagli. Prima c'era un elenco piatto raggruppato per data: un calendario
// vero si scorre e si legge a colpo d'occhio, un elenco no.
//
// Chi ha una sessione admin (fdo, staff o sistemista), toccando un giorno,
// trova anche il modulo per aggiungere o togliere un evento — `GiornoSheetAdmin`
// è importato in lazy dal pannello admin: chi non ha una sessione (la
// stragrande maggioranza di chi apre questa pagina) non lo scarica.
import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { Loader2, AlertTriangle, ChevronLeft, ChevronRight, X, Printer, Download } from "lucide-react";
import * as conferenze from "./conferenzeApi";
import type { Occorrenza, Agenda } from "./conferenzeApi";
import { T, type Lang } from "./i18n";
import { RED, GREEN, GREEN_T, OOS_C, OOS_T, FG, SUB, DIV, SURF, CHIP } from "./tema";
import type { Role as AdminRole } from "./AdminPanel";

const GiornoSheetAdmin = lazy(() => import("./AdminPanel").then((m) => ({ default: m.GiornoSheetAdmin })));
const CambiaPasswordObbligata = lazy(() => import("./AdminPanel").then((m) => ({ default: m.CambiaPasswordObbligata })));

const oggiISO = () => new Date().toLocaleDateString("sv-SE");   // "2026-10-07"

/** "lun 7 ott 2026" — intestazione del foglio giorno. */
function dataLunga(iso: string, lang: Lang) {
  const d = new Date(iso + "T00:00:00");
  const t = T[lang];
  const giorno = t.days[(d.getDay() + 6) % 7];
  return `${giorno} ${d.getDate()} ${t.mesiBrevi[d.getMonth()]} ${d.getFullYear()}`;
}

const LOCALE_PER_LINGUA: Record<Lang, string> = {
  it: "it-IT", en: "en-GB", fr: "fr-FR", de: "de-DE", es: "es-ES", nap: "it-IT",
};

/**
 * Le celle del mese, in ordine di calendario (lunedì–domenica).
 *
 * `null` prima del giorno 1 e dopo l'ultimo: così ogni riga della griglia è
 * sempre una settimana completa di 7 celle, invece di dover calcolare a mano
 * dove va a capo.
 */
function griglia(anno: number, mese: number): (string | null)[] {
  const primo = new Date(anno, mese, 1);
  const offset = (primo.getDay() + 6) % 7;   // lun=0 … dom=6
  const giorniNelMese = new Date(anno, mese + 1, 0).getDate();
  const celle: (string | null)[] = [];
  for (let i = 0; i < offset; i++) celle.push(null);
  for (let g = 1; g <= giorniNelMese; g++) {
    celle.push(`${anno}-${String(mese + 1).padStart(2, "0")}-${String(g).padStart(2, "0")}`);
  }
  while (celle.length % 7 !== 0) celle.push(null);
  return celle;
}

export default function Conferenze({ lang, adminRole }: { lang: Lang; adminRole: AdminRole | null }) {
  const t = T[lang];
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(false);
  const [selezionato, setSelezionato] = useState<string | null>(null);
  const [stampaAperta, setStampaAperta] = useState(false);

  const oggi = oggiISO();
  const [oa, om] = oggi.split("-").map(Number);
  const [vista, setVista] = useState({ anno: oa, mese: om - 1 });

  // Un account con la password appena creata o reimpostata dal sistemista
  // deve cambiarla prima di poter fare qualunque altra cosa — vedi
  // CambiaPasswordObbligata. Quel controllo vive dentro AdminScreens, che
  // qui non c'è: la programmazione della sala e' raggiungibile da questa
  // pagina anche senza mai passare da una scheda amministrativa, quindi va
  // ripetuto qui.
  const [deveCambiare, setDeveCambiare] = useState(false);
  const controllaSessione = useCallback(() => {
    if (adminRole === null) return;
    fetch("/api/admin/auth").then((r) => r.json())
      .then((d) => setDeveCambiare(Boolean(d.deve_cambiare_password)))
      .catch(() => {});
  }, [adminRole]);
  useEffect(() => { controllaSessione(); }, [controllaSessione]);

  // Un solo giro di rete per un anno intero: la navigazione fra mesi diventa
  // locale (si filtrano gli stessi dati), invece di ricaricare a ogni clic
  // su "mese successivo".
  const carica = useCallback(async () => {
    setLoading(true);
    try { setAgenda(await conferenze.agenda(400)); setErrore(false); }
    catch { setErrore(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { carica(); }, [carica]);

  if (loading && !agenda) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: SUB }}>
        <Loader2 size={26} className="animate-spin-slow" style={{ color: RED }} />
        <p className="text-sm">{t.loading}</p>
      </div>
    );
  }

  if (errore && !agenda) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center" style={{ color: SUB }}>
        <AlertTriangle size={26} style={{ color: OOS_T }} />
        <p className="text-sm">{t.netError}</p>
        <button onClick={() => carica()}
          className="rounded-xl px-4 py-2 text-sm font-semibold"
          style={{ background: RED, color: "var(--primary-foreground)" }}>{t.retry}</button>
      </div>
    );
  }

  const occupata = agenda?.occupata_adesso ?? false;

  const occByData = new Map<string, Occorrenza[]>();
  for (const o of agenda?.occorrenze ?? []) {
    (occByData.get(o.data) ?? occByData.set(o.data, []).get(o.data)!).push(o);
  }

  const celle = griglia(vista.anno, vista.mese);
  const eMeseCorrente = vista.anno === oa && vista.mese === om - 1;
  // "agosto 2026" — capitalize lo mette a inizio frase come nelle altre lingue.
  const nomeMese = new Date(vista.anno, vista.mese, 1)
    .toLocaleDateString(LOCALE_PER_LINGUA[lang], { month: "long", year: "numeric" });

  function cambiaMese(delta: number) {
    setVista(({ anno, mese }) => {
      let m = mese + delta, a = anno;
      if (m < 0) { m = 11; a--; }
      if (m > 11) { m = 0; a++; }
      return { anno: a, mese: m };
    });
  }

  return (
    // max-w-2xl: sul desktop il corpo pagina arriva a 1600px, e un calendario
    // di 7 colonne stiracchiato su quella larghezza aveva celle enormi. Non
    // il minimo indispensabile pero': celle troppo strette si leggono male
    // quanto celle troppo larghe, questa via di mezzo resta un calendario
    // vero, non un widget compresso in un angolo.
    <div className="flex-1 overflow-y-auto px-5 pb-8 max-w-2xl mx-auto w-full">
      {/* La risposta alla domanda per cui uno apre questa schermata, in cima
          e grande: "posso entrarci adesso?" */}
      <div className="rounded-2xl border p-5 mt-3 mb-5 text-center"
        style={{
          background: occupata
            ? `color-mix(in srgb, ${OOS_C} 8%, transparent)`
            : `color-mix(in srgb, ${GREEN} 8%, transparent)`,
          borderColor: occupata ? OOS_C : GREEN,
        }}>
        <p className="text-[11px] font-mono tracking-widest uppercase mb-1" style={{ color: SUB }}>
          {t.salaConferenze}
        </p>
        <p className="text-2xl font-bold" style={{ color: occupata ? OOS_T : GREEN_T }}>
          {occupata ? t.occupataOra : t.liberaOra}
        </p>
        {/* Da cosa è occupata. "Occupata adesso" da solo lascia comunque a
            chiedere in giro — cioè la telefonata che questa pagina esiste per
            evitare. Il titolo viene dalla stessa riga che ha deciso
            `occupata_adesso`, quindi le due non possono contraddirsi. */}
        {occupata && agenda?.evento_adesso && (
          <p className="text-base font-semibold mt-1" style={{ color: FG, overflowWrap: "anywhere" }}>
            {agenda.evento_adesso}
          </p>
        )}
        {occupata && agenda?.note_adesso && (
          <p className="text-xs mt-0.5" style={{ color: SUB, overflowWrap: "anywhere" }}>
            {agenda.note_adesso}
          </p>
        )}
        {occupata && agenda?.libera_dalle && (
          <p className="text-sm mt-1" style={{ color: SUB }}>
            {t.liberaDalle(agenda.libera_dalle)}
          </p>
        )}
      </div>

      {/* Navigazione mese. Indietro si ferma al mese corrente: prima di oggi
          non c'e' niente da programmare, e la sala non tiene comunque uno
          storico da consultare qui. */}
      <div className="flex items-center justify-between mb-3 px-1">
        <button onClick={() => cambiaMese(-1)} disabled={eMeseCorrente}
          className="p-2 rounded-xl disabled:opacity-30 transition-opacity"
          style={{ color: SUB }} aria-label="Mese precedente">
          <ChevronLeft size={18} />
        </button>
        <p className="text-sm font-bold capitalize" style={{ color: FG }}>{nomeMese}</p>
        <button onClick={() => cambiaMese(1)}
          className="p-2 rounded-xl" style={{ color: SUB }} aria-label="Mese successivo">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Intestazione giorni della settimana */}
      <div className="grid grid-cols-7 mb-1">
        {t.days.map((d) => (
          <div key={d} className="text-center text-[10px] font-mono uppercase py-1" style={{ color: SUB }}>
            {d[0]}
          </div>
        ))}
      </div>

      {/* Griglia del mese. Un puntino per giorno con impegni (non il numero
          di eventi: su un telefono tre puntini si leggono, "3" accanto a un
          "22" si confondono con la data). Il dettaglio vero sta nel foglio
          che si apre toccando il giorno. */}
      <div className="grid grid-cols-7 gap-1">
        {celle.map((iso, i) => {
          if (!iso) return <div key={`vuota-${i}`} />;
          const eventi = occByData.get(iso) ?? [];
          const isOggi = iso === oggi;
          const passato = iso < oggi;
          return (
            <button key={iso} onClick={() => setSelezionato(iso)}
              className="aspect-square rounded-xl flex flex-col items-center justify-center gap-1 border transition-transform active:scale-95"
              style={{
                background: isOggi ? `color-mix(in srgb, ${RED} 10%, transparent)` : "transparent",
                borderColor: isOggi ? RED : "transparent",
                opacity: passato ? 0.35 : 1,
              }}>
              <span className="text-xs font-mono" style={{ color: isOggi ? RED : FG }}>
                {Number(iso.slice(-2))}
              </span>
              <div className="flex gap-0.5 h-1">
                {eventi.slice(0, 3).map((_, j) => (
                  <span key={j} className="block rounded-full" style={{ width: 4, height: 4, background: RED }} />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Il foglio da stampare o esportare, per chiunque amministri. Serve al
          caso concreto per cui una sala si programma: appenderne l'elenco
          fuori dalla porta, o mandarlo a chi non usa l'app. */}
      {adminRole !== null && (
        <button onClick={() => setStampaAperta(true)}
          className="w-full mt-5 py-3 rounded-2xl text-sm font-semibold border flex items-center justify-center gap-2"
          style={{ borderColor: DIV, color: SUB, background: "transparent" }}>
          <Printer size={15} /> Stampa o esporta gli impegni
        </button>
      )}

      {stampaAperta && (
        <FoglioStampa
          occorrenze={agenda?.occorrenze ?? []}
          lang={lang}
          onClose={() => setStampaAperta(false)}
        />
      )}

      {/* Foglio giorno: dettaglio in lettura per chiunque, modulo di
          aggiunta/rimozione in più per chi ha una sessione admin. */}
      {selezionato && (
        <GiornoSheet
          data={selezionato}
          eventi={occByData.get(selezionato) ?? []}
          lang={lang}
          adminRole={adminRole}
          deveCambiare={deveCambiare}
          onClose={() => setSelezionato(null)}
          onCambioPassword={controllaSessione}
          // Si ricarica la NOSTRA finestra invece di fidarsi di quella che
          // torna dalla scrittura: conference_add/delete rispondono con
          // un'agenda di 60 giorni, mentre qui se ne tengono 400. Prendendo
          // la loro, ogni evento oltre i due mesi spariva dal calendario
          // appena se ne aggiungeva o toglieva un altro — e riappariva solo
          // ricaricando la pagina. Proprio il caso della programmazione
          // annuale per cui questa sala esiste.
          onCambiato={carica}
        />
      )}
    </div>
  );
}

// ─── Foglio da stampare o esportare ──────────────────────────────────────────
//
// Il caso concreto per cui una sala si programma: appendere l'elenco fuori
// dalla porta, o mandarlo a chi in app non ci entra mai. Sono due formati
// perche' sono due usi diversi — la stampa e' per il muro, il CSV e' per chi
// deve rimaneggiare le date in un foglio di calcolo.
//
// La stampa non apre una pagina nuova: `@media print` in style.css nasconde
// tutto il resto dell'app e lascia solo questo riquadro. Una finestra nuova
// avrebbe voluto dire ricostruire li' dentro font, temi e stili, e su iOS
// viene spesso bloccata come popup.

function FoglioStampa({ occorrenze, lang, onClose }: {
  occorrenze: Occorrenza[]; lang: Lang; onClose: () => void;
}) {
  const t = T[lang];
  const oggi = oggiISO();

  // Solo da oggi in avanti: un foglio da appendere non ha ragione di
  // elencare gli impegni della settimana scorsa.
  const righe = occorrenze
    .filter((o) => o.data >= oggi)
    .sort((a, b) => a.data.localeCompare(b.data) || a.inizio.localeCompare(b.inizio));

  const perMese = new Map<string, Occorrenza[]>();
  for (const o of righe) {
    const k = o.data.slice(0, 7);
    (perMese.get(k) ?? perMese.set(k, []).get(k)!).push(o);
  }

  const nomeMese = (chiave: string) => {
    const [a, m] = chiave.split("-").map(Number);
    return new Date(a, m - 1, 1).toLocaleDateString(LOCALE_PER_LINGUA[lang], { month: "long", year: "numeric" });
  };

  function scaricaCsv() {
    // Punto e virgola, non virgola: Excel in locale italiano apre i file con
    // la virgola mettendo tutto in una colonna sola, ed e' il primo posto
    // dove questo foglio finira'.
    const esc = (v: string) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const testo = [
      ["Data", "Inizio", "Fine", "Attivita", "Note"].join(";"),
      ...righe.map((o) => [o.data, o.inizio, o.fine, o.titolo, o.note ?? ""].map(esc).join(";")),
    ].join("\r\n");
    // BOM: senza, Excel legge il file come ANSI e le accentate si rompono.
    const blob = new Blob(["﻿" + testo], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sala-polivalente-${oggi}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end schermo-solo" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="foglio-modale w-full rounded-t-3xl px-6" style={{ background: "var(--background)" }} onClick={(e) => e.stopPropagation()}>
        <div className="foglio-modale__testa pt-6">
          <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }} />
          <div className="flex items-center justify-between mb-4">
            <p className="text-base font-bold" style={{ color: FG }}>Impegni della sala</p>
            <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: SUB, background: CHIP }}><X size={16} /></button>
          </div>
        </div>

        <div className="foglio-modale__corpo pb-4">
          {righe.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: SUB }}>{t.nessunaOccupazione}</p>
          ) : (
            <>
              <p className="text-xs mb-3" style={{ color: SUB }}>
                {righe.length} impegn{righe.length === 1 ? "o" : "i"} da oggi in avanti.
              </p>
              {/* Questo e' anche cio' che finisce sul foglio: l'anteprima non
                  e' una versione ridotta, e' esattamente la stampa. */}
              <div id="foglio-stampa">
                <div className="solo-in-stampa">
                  <h1>{t.salaConferenze}</h1>
                  <p className="sottotitolo">
                    Impegni dal {new Date(oggi + "T00:00:00").toLocaleDateString(LOCALE_PER_LINGUA[lang], { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                </div>

                {[...perMese.entries()].map(([mese, elenco]) => (
                  <div key={mese} className="mb-4">
                    <p className="text-[11px] font-mono tracking-widest uppercase mb-1.5 capitalize" style={{ color: SUB }}>
                      {nomeMese(mese)}
                    </p>
                    <table className="tabella-impegni">
                      <tbody>
                        {elenco.map((o, i) => (
                          <tr key={o.id + "-" + o.data + "-" + i}>
                            <td className="col-data">
                              {new Date(o.data + "T00:00:00").toLocaleDateString(LOCALE_PER_LINGUA[lang], { weekday: "short", day: "numeric" })}
                            </td>
                            <td className="col-ora">{o.inizio}–{o.fine}</td>
                            <td className="col-cosa">
                              {o.titolo}
                              {o.note && <span className="nota"> · {o.note}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="foglio-modale__piede pb-7 pt-3 flex gap-2">
          <button onClick={scaricaCsv} disabled={righe.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold border"
            style={{ borderColor: DIV, color: SUB, background: "transparent", opacity: righe.length ? 1 : 0.5 }}>
            <Download size={15} /> CSV
          </button>
          <button onClick={() => window.print()} disabled={righe.length === 0}
            className="flex-[2] flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold"
            style={{ background: RED, color: "var(--primary-foreground)", opacity: righe.length ? 1 : 0.5 }}>
            <Printer size={15} /> Stampa
          </button>
        </div>
      </div>
    </div>
  );
}

function GiornoSheet({ data, eventi, lang, adminRole, deveCambiare, onClose, onCambioPassword, onCambiato }: {
  data: string; eventi: Occorrenza[]; lang: Lang; adminRole: AdminRole | null; deveCambiare: boolean;
  onClose: () => void; onCambioPassword: () => void; onCambiato: () => void | Promise<void>;
}) {
  const t = T[lang];
  return (
    <div className="absolute inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      {/* foglio-modale: la data resta sempre in testa, il contenuto scorre
          sotto. Misurato prima di questa modifica su 375x667: 692px di
          contenuto in 567px visibili, col pulsante "Aggiungi evento" 93px
          sotto il bordo e nessun segnale che ci fosse. */}
      <div className="foglio-modale w-full rounded-t-3xl px-6" style={{ background: "var(--background)" }} onClick={(e) => e.stopPropagation()}>
        <div className="foglio-modale__testa pt-6">
          <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }} />
          <div className="flex items-center justify-between mb-4">
            <p className="text-base font-bold capitalize" style={{ color: FG }}>{dataLunga(data, lang)}</p>
            <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: SUB, background: CHIP }}><X size={16} /></button>
          </div>
        </div>

        <div className="foglio-modale__corpo pb-6">

        {adminRole !== null ? (
          <Suspense fallback={<p className="text-sm" style={{ color: SUB }}>{t.loading}</p>}>
            {deveCambiare
              ? <CambiaPasswordObbligata onFatto={onCambioPassword} />
              : <GiornoSheetAdmin data={data} eventi={eventi} onCambiato={onCambiato} />}
          </Suspense>
        ) : eventi.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: SUB }}>{t.nessunaOccupazione}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {eventi.map((o) => (
              <div key={o.id} className="rounded-2xl border p-3" style={{ borderColor: DIV, background: SURF }}>
                <p className="text-sm font-mono font-bold" style={{ color: FG }}>{o.inizio}–{o.fine}</p>
                <p className="text-sm" style={{ color: FG }}>{o.titolo}</p>
                {o.note && <p className="text-xs mt-0.5" style={{ color: SUB }}>{o.note}</p>}
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
