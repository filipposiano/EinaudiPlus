// Conferenze.tsx — la sala polivalente.
//
// A differenza di cinema e musica qui i residenti non prenotano: la sala la
// programma la direzione. Quindi per loro la schermata risponde a una domanda
// sola, e la mette in cima grande: **adesso è libera?**
//
// Sotto, il calendario dei prossimi impegni. La programmazione può arrivare
// a un anno, quindi si guarda un mese per volta e si può allungare.
//
// Chi ha una sessione admin (fdo, staff o sistemista) trova qui sotto anche
// il modulo per programmarla: prima viveva in una scheda a sé nel pannello
// amministrativo ("Programmazione"), separata dalla pagina che chiunque
// guarda per sapere se la sala è libera — due posti per la stessa sala.
// `SalaConferenze` e' importata in lazy dal pannello admin: chi non ha una
// sessione (la stragrande maggioranza di chi apre questa pagina) non la
// scarica.
import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { Loader2, AlertTriangle, CalendarDays } from "lucide-react";
import * as conferenze from "./conferenzeApi";
import type { Occorrenza } from "./conferenzeApi";
import { T, type Lang } from "./i18n";
import { RED, GREEN, GREEN_T, OOS_C, OOS_T, FG, SUB, DIV, SURF } from "./tema";
import type { Role as AdminRole } from "./AdminPanel";

const SalaConferenzeAdmin = lazy(() => import("./AdminPanel").then((m) => ({ default: m.SalaConferenze })));
const CambiaPasswordObbligata = lazy(() => import("./AdminPanel").then((m) => ({ default: m.CambiaPasswordObbligata })));

/** "lun 7 ott" — data breve, nella lingua scelta. */
function dataBreve(iso: string, lang: Lang) {
  const d = new Date(iso + "T00:00:00");
  const t = T[lang];
  const giorno = t.days[(d.getDay() + 6) % 7];
  return `${giorno} ${d.getDate()} ${t.mesiBrevi[d.getMonth()]}`;
}

const oggiISO = () => new Date().toLocaleDateString("sv-SE");   // "2026-10-07"

export default function Conferenze({ lang, adminRole }: { lang: Lang; adminRole: AdminRole | null }) {
  const t = T[lang];
  const [agenda, setAgenda] = useState<conferenze.Agenda | null>(null);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(false);
  // Un mese per volta: la programmazione può arrivare a un anno, ma mostrarla
  // tutta insieme sarebbe un muro. Si allunga quando serve.
  const [giorni, setGiorni] = useState(30);

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

  const carica = useCallback(async (g: number) => {
    setLoading(true);
    try { setAgenda(await conferenze.agenda(g)); setErrore(false); }
    catch { setErrore(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { carica(giorni); }, [carica, giorni]);

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
        <button onClick={() => carica(giorni)}
          className="rounded-xl px-4 py-2 text-sm font-semibold"
          style={{ background: RED, color: "var(--primary-foreground)" }}>{t.retry}</button>
      </div>
    );
  }

  const occupata = agenda?.occupata_adesso ?? false;
  const oggi = oggiISO();

  // Raggruppate per data: una prenotazione per riga sarebbe un elenco piatto in
  // cui il giorno si ripete a ogni voce.
  const perGiorno = new Map<string, Occorrenza[]>();
  for (const o of agenda?.occorrenze ?? []) {
    (perGiorno.get(o.data) ?? perGiorno.set(o.data, []).get(o.data)!).push(o);
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-8">
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
        {occupata && agenda?.libera_dalle && (
          <p className="text-sm mt-1" style={{ color: SUB }}>
            {t.liberaDalle(agenda.libera_dalle)}
          </p>
        )}
      </div>

      <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color: SUB }}>
        {t.prossimeOccupazioni}
      </p>

      {perGiorno.size === 0 ? (
        <p className="text-sm py-6 text-center" style={{ color: SUB }}>{t.nessunaOccupazione}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {[...perGiorno.entries()].map(([data, righe]) => (
            <div key={data} className="rounded-2xl border overflow-hidden"
              style={{ background: SURF, borderColor: DIV }}>
              <div className="px-4 py-2 flex items-center gap-2 border-b"
                style={{ borderColor: DIV, background: "var(--muted)" }}>
                <CalendarDays size={13} style={{ color: SUB }} />
                <span className="text-xs font-semibold" style={{ color: FG }}>
                  {dataBreve(data, lang)}
                </span>
                {data === oggi && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: `color-mix(in srgb, ${RED} 15%, transparent)`, color: RED }}>
                    {t.oggi}
                  </span>
                )}
              </div>
              {righe.map((o, i) => (
                <div key={o.id + "-" + i} className="px-4 py-2.5 flex items-baseline gap-3"
                  style={{ borderTop: i === 0 ? "none" : `1px solid ${DIV}` }}>
                  <span className="text-sm font-mono font-bold shrink-0" style={{ color: FG }}>
                    {o.inizio}–{o.fine}
                  </span>
                  <span className="text-sm min-w-0" style={{ color: FG, overflowWrap: "anywhere" }}>
                    {o.titolo}
                    {o.note && <span className="block text-xs" style={{ color: SUB }}>{o.note}</span>}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Si allunga invece di caricare un anno subito: chi guarda "è libera
          adesso?" non ha bisogno di sapere cosa succede a maggio. */}
      {giorni < 365 && (
        <button onClick={() => setGiorni((g) => (g < 90 ? 90 : 365))}
          disabled={loading}
          className="w-full mt-4 py-3 rounded-2xl text-sm font-semibold border"
          style={{ borderColor: DIV, color: SUB, background: "transparent" }}>
          {loading ? "…" : giorni < 90 ? t.guardaTreMesi : t.guardaAnno}
        </button>
      )}

      {/* Solo per chi ha una sessione admin: la programmazione vera e propria
          vive qui, non altrove — vedi la nota in cima al file. */}
      {adminRole !== null && (
        <div className="mt-8 pt-6 border-t" style={{ borderColor: DIV }}>
          <p className="text-[11px] font-mono tracking-widest uppercase mb-3" style={{ color: SUB }}>
            {t.amministrazione}
          </p>
          <Suspense fallback={null}>
            {deveCambiare
              ? <CambiaPasswordObbligata onFatto={controllaSessione} />
              : <SalaConferenzeAdmin />}
          </Suspense>
        </div>
      )}
    </div>
  );
}
