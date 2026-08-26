// Sale.tsx — le sale viste tutte insieme.
//
// Cinema, musica e polivalente avevano ciascuna la propria schermata, e per
// sapere se stasera c'era una sala libera bisognava aprirle a una a una. Qui
// stanno sulla stessa pagina, ognuna con la sua giornata disegnata: si guarda
// una volta e si sa dove andare.
//
// Due cose vivono in questo file:
//   • `SaleAdesso`, la striscia che sta in fondo alla dashboard della
//     lavanderia ("le sale, adesso") — tre righe, stato e basta;
//   • `SaleOverview`, la schermata intera, con la barra della giornata di
//     ciascuna sala e il pulsante per andarci a prenotare.
//
// Nessuna delle due prenota: prenotare resta dentro la sala, dove c'è il
// contorno per farlo (chi c'è prima, chi dopo, le regole). Da qui si sceglie
// SOLO quale sala aprire — che era la domanda a cui non rispondeva nessuno.

import { useState, useEffect, useCallback } from "react";
import { Film, Music, Presentation, Loader2 } from "lucide-react";
import * as roomsApi from "./roomsApi";
import type { RoomKind, RoomBooking } from "./roomsApi";
import * as conferenzeApi from "./conferenzeApi";
import { T } from "./i18n";
import type { Lang } from "./i18n";

const fg   = "var(--foreground)";
const sub  = "var(--gray-accessible-text)";
const surf = "var(--card)";
const div  = "var(--border)";
const RED  = "var(--primary)";
const SAGE = "var(--status-free)";
const SAGE_T = "var(--status-free-text)";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtMin = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const TODAY = (new Date().getDay() + 6) % 7;   // 0 = lunedì, come ovunque nell'app

/** Le tre destinazioni raggiungibili da qui. Combaciano con `Facility` in App.tsx. */
export type SalaId = "cinema" | "music" | "conferenze";

/** Un blocco occupato della giornata, in minuti dalla mezzanotte. */
export interface Blocco { start: number; end: number; mine: boolean; chi?: string }

export interface StatoSala {
  id: SalaId;
  nome: string;
  /** Occupata proprio adesso. */
  occupata: boolean;
  /** L'ora in cui si libera, se occupata; l'ora in cui si occupa, se libera e
   *  qualcosa è già prenotato più tardi. Vuoto se la giornata è tutta libera. */
  fino?: string;
  /** Chi la occupa adesso: una camera, o il titolo dell'evento. */
  chi?: string;
  blocchi: Blocco[];
  /** La polivalente non si prenota dall'app: la programma la Direzione. */
  prenotabile: boolean;
}

const ICONE: Record<SalaId, any> = { cinema: Film, music: Music, conferenze: Presentation };

/**
 * "Adesso" in minuti dalla mezzanotte.
 *
 * Ricalcolato a ogni chiamata e non congelato come `NOW` della lavanderia: qui
 * serve a decidere se una fascia è in corso, e una fascia finisce a un minuto
 * qualunque — non all'inizio di un turno.
 */
const oraOra = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** La fine "vera" di una fascia che scavalca la mezzanotte. */
const fineDi = (b: { start: number; end: number }) => (b.end <= b.start ? b.end + 24 * 60 : b.end);

function statoDaBlocchi(blocchi: Blocco[]): { occupata: boolean; fino?: string; chi?: string } {
  const ora = oraOra();
  const corrente = blocchi.find((b) => b.start <= ora && ora < fineDi(b));
  if (corrente) return { occupata: true, fino: fmtMin(corrente.end % (24 * 60)), chi: corrente.chi };
  // Libera: la prossima occupazione della giornata, se c'è, dice fino a quando.
  const prossima = blocchi.filter((b) => b.start > ora).sort((a, b) => a.start - b.start)[0];
  return { occupata: false, fino: prossima ? fmtMin(prossima.start) : undefined };
}

/**
 * Lo stato delle tre sale, oggi.
 *
 * Tre chiamate in parallelo, e nessuna che possa far fallire le altre: se il
 * polivalente non risponde, cinema e musica si vedono lo stesso. Una sala che
 * non risponde semplicemente non compare — meglio di una riga che dice il
 * falso.
 */
export function useSale(lang: Lang, roomNumber: string | null) {
  const t = T[lang];
  const [sale, setSale]       = useState<StatoSala[] | null>(null);
  const [loading, setLoading] = useState(true);

  const carica = useCallback(async () => {
    const mio = (roomNumber || "").trim();

    const daSala = async (id: RoomKind, nome: string): Promise<StatoSala | null> => {
      try {
        const list: RoomBooking[] = await roomsApi.getRoomBookings(id);
        const blocchi: Blocco[] = list
          .filter((b) => b.day === TODAY)
          .map((b) => ({ start: b.start, end: b.end, mine: !!mio && b.name === mio, chi: b.name }))
          .sort((a, b) => a.start - b.start);
        return { id, nome, blocchi, prenotabile: true, ...statoDaBlocchi(blocchi) };
      } catch { return null; }
    };

    const daPolivalente = async (): Promise<StatoSala | null> => {
      try {
        const ag = await conferenzeApi.agenda(2);
        const oggi = new Date();
        const iso = `${oggi.getFullYear()}-${pad(oggi.getMonth() + 1)}-${pad(oggi.getDate())}`;
        const min = (h: string) => {
          const [a, b] = h.split(":");
          return Number(a) * 60 + Number(b || 0);
        };
        const blocchi: Blocco[] = ag.occorrenze
          .filter((o) => o.data === iso)
          .map((o) => ({ start: min(o.inizio), end: min(o.fine), mine: false, chi: o.titolo }))
          .sort((a, b) => a.start - b.start);
        return {
          id: "conferenze", nome: t.salaConferenze, blocchi, prenotabile: false,
          ...statoDaBlocchi(blocchi),
        };
      } catch { return null; }
    };

    const out = await Promise.all([
      daSala("cinema", t.navCinema),
      daSala("music", t.navMusica),
      daPolivalente(),
    ]);
    setSale(out.filter((s): s is StatoSala => s !== null));
    setLoading(false);
  }, [lang, roomNumber, t]);

  useEffect(() => { void carica(); }, [carica]);

  return { sale, loading, ricarica: carica };
}

/** La frase di stato: "Libera adesso", "Occupata · si libera alle 16:00". */
function frase(s: StatoSala, t: any): string {
  if (s.occupata) return s.fino ? `${t.occupataOra} · ${t.liberaDalle(s.fino)}` : t.occupataOra;
  if (s.fino) return `${t.liberaOra} · ${t.occupataDalle(s.fino)}`;
  return t.liberaOra;
}

// ─── La striscia in dashboard ────────────────────────────────────────────────

export function SaleAdesso({ lang, roomNumber, onApri }: {
  lang: Lang; roomNumber: string | null; onApri: (id: SalaId) => void;
}) {
  const t = T[lang];
  const { sale, loading } = useSale(lang, roomNumber);

  // Mentre carica non si mette uno scheletro grigio: questa sezione sta in
  // fondo alla dashboard, e un blocco che compare dopo mezzo secondo sposta
  // quel che si stava leggendo. Prima non c'è, poi c'è.
  if (loading || !sale || sale.length === 0) return null;

  return (
    <section className="px-5 mb-4">
      <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.saleAdesso}</p>
      <div className="flex flex-col gap-2">
        {sale.map((s) => {
          const Icona = ICONE[s.id];
          return (
            <button key={s.id} onClick={()=>onApri(s.id)}
              className="w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all active:scale-[0.99]"
              style={{ background:surf, borderColor:div }}>
              <span className="p-2 rounded-xl shrink-0"
                style={ s.occupata
                  ? { background:"var(--secondary)", color:sub }
                  : { background:`color-mix(in srgb, ${SAGE} 20%, transparent)`, color:SAGE_T } }>
                <Icona size={16}/>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color:fg }}>{s.nome}</p>
                <p className="text-[11px] truncate" style={{ color: s.occupata ? sub : SAGE_T }}>{frase(s, t)}</p>
              </div>
              {s.prenotabile && !s.occupata && (
                <span className="text-[10px] font-bold rounded-full px-2.5 py-1 shrink-0"
                  style={{ border:`1px solid ${RED}`, color:RED }}>{t.book}</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─── La barra della giornata ─────────────────────────────────────────────────
//
// Ventiquattro ore da bordo a bordo, i blocchi occupati disegnati sopra. Non è
// la timeline della singola sala (quella, dentro Rooms.tsx, ha le etichette e
// i nomi): qui serve solo la FORMA della giornata — quanto è piena, e dove.

function BarraGiorno({ blocchi }: { blocchi: Blocco[] }) {
  const pc = (m: number) => `${Math.max(0, Math.min(100, (m / (24 * 60)) * 100))}%`;
  const ora = oraOra();
  return (
    <>
      <div className="relative h-6 rounded-full overflow-hidden"
        style={{ background:`color-mix(in srgb, ${SAGE} 22%, transparent)` }}>
        {blocchi.map((b, i) => (
          <span key={i} className="absolute top-0 bottom-0"
            style={{
              left: pc(b.start),
              width: pc(Math.min(fineDi(b), 24 * 60) - b.start),
              background: b.mine ? RED : "var(--switch-background)",
            }}/>
        ))}
        {/* Dove siamo adesso: senza questa riga la barra è una giornata
            qualunque, e non si capisce se il blocco grigio è già passato. */}
        <span className="absolute top-0 bottom-0 w-0.5" style={{ left:pc(ora), background:fg, opacity:0.55 }}/>
      </div>
      <div className="flex justify-between text-[9px] mt-1" style={{ color:sub }}>
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
    </>
  );
}

// ─── La schermata ────────────────────────────────────────────────────────────

export default function SaleOverview({ lang, roomNumber, onApri }: {
  lang: Lang; roomNumber: string | null; onApri: (id: SalaId) => void;
}) {
  const t = T[lang];
  const { sale, loading } = useSale(lang, roomNumber);
  const oggi = new Date();

  return (
    <div className="flex flex-col pb-6 md:pt-8 md:max-w-3xl md:mx-auto md:w-full">
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-2xl font-bold font-display" style={{ color:fg }}>{t.navSale}</h2>
        <p className="text-xs mt-1" style={{ color:sub }}>
          {t.fmtDay(oggi)} · {t.saleNessunLimite}
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16" style={{ color:sub }}>
          <Loader2 size={20} className="animate-spin"/>
        </div>
      )}

      {!loading && sale && sale.length === 0 && (
        <p className="px-5 text-sm" style={{ color:sub }}>{t.saleNonDisponibili}</p>
      )}

      <div className="px-5 flex flex-col gap-3">
        {(sale ?? []).map((s) => {
          const Icona = ICONE[s.id];
          return (
            <div key={s.id} className="rounded-2xl border p-4" style={{ background:surf, borderColor:div }}>
              <div className="flex items-center gap-3 mb-3">
                <span className="p-2 rounded-xl shrink-0"
                  style={ s.occupata
                    ? { background:"var(--secondary)", color:sub }
                    : { background:`color-mix(in srgb, ${SAGE} 20%, transparent)`, color:SAGE_T } }>
                  <Icona size={17}/>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold font-display truncate" style={{ color:fg }}>{s.nome}</p>
                  <p className="text-[11px] truncate" style={{ color: s.occupata ? sub : SAGE_T }}>
                    {frase(s, t)}{s.chi ? ` · ${s.chi}` : ""}
                  </p>
                </div>
              </div>

              <BarraGiorno blocchi={s.blocchi}/>

              <button onClick={()=>onApri(s.id)}
                className="w-full mt-3 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98]"
                style={ s.prenotabile
                  ? { background:`color-mix(in srgb, var(--primary) 12%, transparent)`, color:RED }
                  : { background:"var(--secondary)", color:fg } }>
                {/* Il polivalente lo programma la Direzione: da qui si va a
                    guardarlo, non a prenotarlo, e il pulsante lo dice. */}
                {s.prenotabile
                  ? (s.occupata && s.fino ? t.prenotaDalle(s.fino) : t.prenotaFascia)
                  : t.vediProgramma}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
