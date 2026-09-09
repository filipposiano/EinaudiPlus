// Bici.tsx — sezione Bici: una camera dichiara se ha una bici in collegio.
//
// Non è una prenotazione: è una dichiarazione sola, sì o no, che portineria e
// sistemista vedono dal loro pannello (AdminPanel.tsx, sezione "Bici"). Qui
// c'è solo il lato del residente — dichiarare, ritirare la dichiarazione, e
// vedersi la bici che arriva pedalando quando la dichiarazione scatta a "sì".

import { useState, useEffect, useCallback } from "react";
import { Bike, Loader2, AlertTriangle, Check } from "lucide-react";
import * as api from "./api";
import type { Lang } from "./i18n";

const RED = "var(--primary)", RED_FG = "var(--primary-foreground)";
const fg = "var(--foreground)", sub = "var(--muted-foreground)";
const surf = "var(--card)", div = "var(--border)";

const T = {
  it: {
    titolo: "Bici",
    desc: "Fai sapere alla portineria se hai una bici in collegio: le basta un'occhiata al pannello, senza girare le camere.",
    siHo: "Hai dichiarato una bici",
    nonHo: "Non hai dichiarato nessuna bici",
    aggiungi: "Sì, ho una bici",
    rimuovi: "Non ce l'ho più",
    loading: "Carico…",
    retry: "Riprova",
    netError: "Impossibile contattare il server.",
    soloCamere: "Questa sezione è per le camere: la Direzione non ne ha una.",
  },
  en: {
    titolo: "Bike",
    desc: "Let the front desk know if you keep a bike at the dorm — one glance at their panel, no need to go room to room.",
    siHo: "You've declared a bike",
    nonHo: "You haven't declared a bike",
    aggiungi: "Yes, I have a bike",
    rimuovi: "I don't have it anymore",
    loading: "Loading…",
    retry: "Retry",
    netError: "Couldn't reach the server.",
    soloCamere: "This section is for rooms: the front desk doesn't have one.",
  },
  fr: {
    titolo: "Vélo",
    desc: "Préviens la réception si tu as un vélo au collège : un coup d'œil à leur panneau leur suffit, sans faire le tour des chambres.",
    siHo: "Tu as déclaré un vélo",
    nonHo: "Tu n'as déclaré aucun vélo",
    aggiungi: "Oui, j'ai un vélo",
    rimuovi: "Je ne l'ai plus",
    loading: "Chargement…",
    retry: "Réessayer",
    netError: "Impossible de joindre le serveur.",
    soloCamere: "Cette section est pour les chambres : la Direction n'en a pas.",
  },
  de: {
    titolo: "Fahrrad",
    desc: "Sag der Rezeption, ob du ein Fahrrad im Kolleg hast — ein Blick ins Panel genügt, ohne jedes Zimmer abzuklappern.",
    siHo: "Du hast ein Fahrrad angegeben",
    nonHo: "Du hast kein Fahrrad angegeben",
    aggiungi: "Ja, ich habe ein Fahrrad",
    rimuovi: "Ich habe es nicht mehr",
    loading: "Wird geladen…",
    retry: "Nochmal versuchen",
    netError: "Server nicht erreichbar.",
    soloCamere: "Dieser Bereich ist für Zimmer: die Verwaltung hat keins.",
  },
  es: {
    titolo: "Bicicleta",
    desc: "Avisa a recepción si tienes una bici en el colegio: les basta un vistazo al panel, sin recorrer las habitaciones.",
    siHo: "Has declarado una bici",
    nonHo: "No has declarado ninguna bici",
    aggiungi: "Sí, tengo una bici",
    rimuovi: "Ya no la tengo",
    loading: "Cargando…",
    retry: "Reintentar",
    netError: "No se puede contactar con el servidor.",
    soloCamere: "Esta sección es para las habitaciones: la Dirección no tiene una.",
  },
  nap: {
    titolo: "Bici",
    desc: "Fa' sapé â portineria si tiene 'na bicicletta 'o cullegio: le vasta n'uocchio ô pannello, senza gghi' cammera pe' cammera.",
    siHo: "Hê dichiarato 'na bici",
    nonHo: "Nun hê dichiarato nisciuna bici",
    aggiungi: "Sì, tengo 'na bici",
    rimuovi: "Nun 'a tengo cchiù",
    loading: "Sto' carrecanno…",
    retry: "Prova n'ata vota",
    netError: "Nun riesco a parlà cu 'o server.",
    soloCamere: "Chesta sezione è pe' 'e cammere: 'a Direzione nun ne tene.",
  },
} as const;

// ─── Illustrazione ───────────────────────────────────────────────────────────
//
// SMIL (<animateTransform>/<animate>), non CSS: sugli elementi SVG la
// transform-origin di CSS segue regole sue, diverse da cx/cy — con SMIL il
// centro di rotazione si scrive nell'attributo stesso ("360 95 105") e non
// c'è ambiguità. In più cosi' l'animazione si può accendere e spegnere di
// netto: quando `attiva` è falso gli elementi <animate*> non vengono proprio
// montati, e tutto resta fermo senza un frame a metà giro.
function BiciSvg({ attiva }: { attiva: boolean }) {
  const stroke  = attiva ? "var(--foreground)" : "var(--muted-foreground)";
  const accento = attiva ? RED : "var(--muted-foreground)";

  const ruota = (cx: number) => (
    <g>
      <circle cx={cx} cy="105" r="27" fill="none" stroke={stroke} strokeWidth="4" />
      <g>
        {attiva && (
          <animateTransform attributeName="transform" type="rotate"
            from={`0 ${cx} 105`} to={`360 ${cx} 105`} dur="0.7s" repeatCount="indefinite" />
        )}
        <line x1={cx} y1="79" x2={cx} y2="131" stroke={stroke} strokeWidth="2.5" />
        <line x1={cx - 26} y1="105" x2={cx + 26} y2="105" stroke={stroke} strokeWidth="2.5" />
        <line x1={cx - 18} y1="87" x2={cx + 18} y2="123" stroke={stroke} strokeWidth="2" />
        <line x1={cx - 18} y1="123" x2={cx + 18} y2="87" stroke={stroke} strokeWidth="2" />
      </g>
    </g>
  );

  return (
    <svg viewBox="0 0 300 150" width="230" height="115" aria-hidden="true"
      style={{ opacity: attiva ? 1 : 0.5, transition: "opacity .3s" }}>
      {/* strada: mentre la bici pedala, le righe corrono all'indietro */}
      <line x1="8" y1="139" x2="292" y2="139" stroke="var(--border)" strokeWidth="3"
        strokeLinecap="round" strokeDasharray="6 12">
        {attiva && <animate attributeName="stroke-dashoffset" from="0" to="-36" dur="0.5s" repeatCount="indefinite" />}
      </line>

      {/* la bici intera entra pedalando in scena da sinistra, con un piccolo
          rimbalzo all'arrivo — rimontata (vedi `key` nel chiamante) ogni
          volta che la dichiarazione passa da "no" a "sì". */}
      <g>
        {attiva && (
          <animateTransform attributeName="transform" type="translate"
            values="-240,0; 8,0; -4,0; 0,0" keyTimes="0; 0.7; 0.87; 1"
            calcMode="spline" keySplines="0.2 0 0.3 1; 0.2 0 0.3 1; 0.2 0 0.3 1"
            dur="0.9s" fill="freeze" />
        )}

        {ruota(90)}
        {ruota(206)}

        {/* telaio */}
        <path d="M90 105 L150 105 L128 50 Z" fill="none" stroke={stroke} strokeWidth="4" strokeLinejoin="round" />
        <line x1="128" y1="50"  x2="190" y2="55"  stroke={stroke} strokeWidth="4" strokeLinecap="round" />
        <line x1="150" y1="105" x2="196" y2="58"  stroke={stroke} strokeWidth="4" strokeLinecap="round" />
        <line x1="196" y1="58"  x2="206" y2="105" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
        {/* manubrio e sella */}
        <line x1="190" y1="55" x2="199" y2="41" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
        <line x1="185" y1="45" x2="207" y2="45" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
        <line x1="120" y1="48" x2="136" y2="48" stroke={stroke} strokeWidth="4" strokeLinecap="round" />

        {/* pedivella, un poco più vivace nel colore */}
        <g>
          {attiva && <animateTransform attributeName="transform" type="rotate" from="0 150 105" to="360 150 105" dur="0.7s" repeatCount="indefinite" />}
          <line x1="150" y1="105" x2="163" y2="105" stroke={accento} strokeWidth="3" strokeLinecap="round" />
          <line x1="150" y1="105" x2="137" y2="105" stroke={accento} strokeWidth="3" strokeLinecap="round" />
        </g>

        {/* ciclista: una sagoma minima, china in avanti come si fa pedalando */}
        <circle cx="172" cy="25" r="11" fill={accento} />
        <path d="M167 34 Q148 42 132 49" fill="none" stroke={accento} strokeWidth="7" strokeLinecap="round" />
        <path d="M168 37 L195 47" fill="none" stroke={accento} strokeWidth="6" strokeLinecap="round" />
        <path d="M136 49 L150 102" fill="none" stroke={accento} strokeWidth="7" strokeLinecap="round" />
      </g>
    </svg>
  );
}

// ─── Vista ───────────────────────────────────────────────────────────────────
export default function BiciView({ lang, roomNumber }: { lang: Lang; roomNumber: string | null }) {
  const t = T[lang];
  // La bici e' una dichiarazione di camera, non della Direzione: DIREZIONE
  // non e' una stanza vera e non ha una bici da segnare.
  const camera = roomNumber && roomNumber !== api.DIREZIONE ? roomNumber : null;

  const [haBici, setHaBici] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  // Cambia solo quando la dichiarazione passa a "sì": rimontando <BiciSvg>
  // con una key diversa, l'animazione d'ingresso riparte da capo invece di
  // restare congelata sull'ultimo fotogramma di quella precedente.
  const [rideKey, setRideKey] = useState(0);

  const load = useCallback(async () => {
    if (!camera) { setLoading(false); return; }
    setLoading(true); setError(false);
    try { setHaBici(await api.getBike(camera)); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [camera]);

  useEffect(() => { load(); }, [load]);

  async function toggle() {
    if (!camera || busy || haBici === null) return;
    const next = !haBici;
    setBusy(true);
    try {
      setHaBici(await api.setBike(camera, next));
      if (next) setRideKey((k) => k + 1);
    } catch { /* stato non cambiato: il pulsante torna semplicemente cliccabile */ }
    finally { setBusy(false); }
  }

  if (!camera) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
        <BiciSvg attiva={false} />
        <p className="text-sm" style={{ color: sub }}>{t.soloCamere}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: sub }}>
        <Loader2 size={26} className="animate-spin-slow" style={{ color: RED }} />
        <p className="text-sm">{t.loading}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center" style={{ color: sub }}>
        <AlertTriangle size={26} style={{ color: "var(--destructive)" }} />
        <p className="text-sm">{t.netError}</p>
        <button onClick={load} className="rounded-xl px-4 py-2 text-sm font-semibold" style={{ background: RED, color: RED_FG }}>
          {t.retry}
        </button>
      </div>
    );
  }

  const attiva = !!haBici;

  return (
    <div className="flex flex-col h-full md:max-w-lg md:mx-auto md:w-full px-5 pt-3 pb-6">
      {/* Come le altre sale: nome e icona solo sul desktop, dove non c'e' gia'
          una topbar che li mostra. */}
      <div className="hidden md:flex items-center gap-2.5 mb-3">
        <div className="p-2 rounded-xl" style={{ background: "color-mix(in srgb, var(--primary) 15%, transparent)", color: RED }}>
          <Bike size={18} />
        </div>
        <h2 className="text-base font-bold" style={{ color: fg }}>{t.titolo}</h2>
      </div>

      <div className="w-full rounded-2xl border p-6 flex flex-col items-center gap-4" style={{ background: surf, borderColor: div }}>
        <BiciSvg key={rideKey} attiva={attiva} />

        <div className="flex items-center gap-1.5">
          {attiva && <Check size={16} style={{ color: RED }} />}
          <p className="text-sm font-semibold text-center" style={{ color: attiva ? RED : fg }}>
            {attiva ? t.siHo : t.nonHo}
          </p>
        </div>

        <p className="text-xs text-center leading-relaxed" style={{ color: sub, maxWidth: "34ch" }}>
          {t.desc}
        </p>

        <button onClick={toggle} disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
          style={attiva
            ? { background: "var(--secondary)", color: fg, opacity: busy ? 0.6 : 1 }
            : { background: RED, color: RED_FG, opacity: busy ? 0.6 : 1 }}>
          {attiva ? t.rimuovi : t.aggiungi}
        </button>
      </div>
    </div>
  );
}
