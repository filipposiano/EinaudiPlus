// Notifiche.tsx — il centro notifiche dentro l'app.
//
// I promemoria del turno arrivano come push di sistema: compaiono, e se uno
// scorre via l'avviso mentre ha le mani bagnate, quella riga è persa. Qui
// restano. Lo storico è quello che il service worker scrive in IndexedDB al
// momento in cui la push arriva (vedi notifiche.ts): è locale al dispositivo,
// e la schermata lo dice invece di far finta che sia un archivio.
//
// Non c'è modo di "creare" una notifica da qui: questa pagina è di sola
// lettura, e l'unica cosa che si tocca sono le impostazioni dei promemoria —
// che stanno già nel foglio Impostazioni e da qui si aprono, non si copiano.

import { useState, useEffect, useCallback } from "react";
import { Bell, BellOff, Trash2, Settings } from "lucide-react";
import { T } from "./i18n";
import type { Lang } from "./i18n";
import { listNotifiche, segnaTutteLette, svuotaStorico, ascoltaNotifiche } from "./notifiche";
import type { Notifica } from "./notifiche";

const fg   = "var(--foreground)";
const sub  = "var(--gray-accessible-text)";
const surf = "var(--card)";
const div  = "var(--border)";
const RED  = "var(--primary)";

/**
 * "ora", "14:20", "ieri", "lun" — quanto è vecchia una notifica.
 *
 * Le ore esatte servono solo per oggi: di un avviso di tre giorni fa interessa
 * che sia di tre giorni fa, non che fosse le 14:20.
 */
function quando(ts: number, lang: Lang): string {
  const t = T[lang];
  const d = new Date(ts);
  const ora = new Date();
  const diff = ora.getTime() - ts;
  if (diff < 60_000) return t.adesso;
  const stessoGiorno = d.toDateString() === ora.toDateString();
  if (stessoGiorno) return t.fmtTime(d);
  const ieri = new Date(ora.getFullYear(), ora.getMonth(), ora.getDate() - 1);
  if (d.toDateString() === ieri.toDateString()) return t.ieri;
  return t.days[(d.getDay() + 6) % 7];
}

export default function Notifiche({ lang, onImpostazioni }: {
  lang: Lang; onImpostazioni: () => void;
}) {
  const t = T[lang];
  const [list, setList] = useState<Notifica[] | null>(null);

  const carica = useCallback(async () => { setList(await listNotifiche()); }, []);

  useEffect(() => {
    // Si carica, e SUBITO DOPO si segna tutto letto: aprire la schermata è
    // l'atto di leggerle. Il pallino sulla campanella si spegne uscendo, non
    // richiede un "segna come letto" che nessuno tocca mai.
    void (async () => { await carica(); await segnaTutteLette(); })();
    return ascoltaNotifiche(() => { void carica(); });
  }, [carica]);

  return (
    <div className="flex flex-col pb-6 md:pt-8 md:max-w-3xl md:mx-auto md:w-full">
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold font-display" style={{ color:fg }}>{t.notifiche}</h2>
          <p className="text-xs mt-1 leading-relaxed" style={{ color:sub }}>{t.notificheIntro}</p>
        </div>
        <button onClick={onImpostazioni} aria-label={t.impostazioni}
          className="p-2 rounded-xl shrink-0 transition-all active:scale-90"
          style={{ background:"var(--secondary)", color:sub }}>
          <Settings size={16}/>
        </button>
      </div>

      <div className="px-5 flex flex-col gap-2">
        {list !== null && list.length === 0 && (
          <div className="rounded-2xl border px-4 py-6 flex flex-col items-center text-center gap-2"
            style={{ background:surf, borderColor:div }}>
            <BellOff size={20} style={{ color:sub }}/>
            <p className="text-sm font-semibold" style={{ color:fg }}>{t.nessunaNotifica}</p>
            <p className="text-[11px] leading-relaxed" style={{ color:sub }}>{t.nessunaNotificaBody}</p>
          </div>
        )}

        {(list ?? []).map((n) => (
          <div key={n.ts} className="flex items-start gap-3 rounded-2xl border px-4 py-3"
            style={{
              background: n.read ? "transparent" : surf,
              borderColor: n.read ? div : `color-mix(in srgb, var(--primary) 35%, transparent)`,
            }}>
            <div className="p-2 rounded-xl shrink-0"
              style={ n.read
                ? { background:"var(--secondary)", color:sub }
                : { background:`color-mix(in srgb, var(--primary) 12%, transparent)`, color:RED } }>
              <Bell size={14}/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color:fg }}>{n.title}</p>
              {n.body && <p className="text-[11px] leading-relaxed mt-0.5" style={{ color:sub }}>{n.body}</p>}
            </div>
            <span className="text-[10px] font-mono shrink-0" style={{ color:sub }}>{quando(n.ts, lang)}</span>
          </div>
        ))}
      </div>

      {list !== null && list.length > 0 && (
        <div className="px-5 mt-4">
          <button onClick={async ()=>{ await svuotaStorico(); await carica(); }}
            className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2 transition-all active:scale-95"
            style={{ background:"var(--secondary)", color:sub }}>
            <Trash2 size={13}/>{t.svuotaStorico}
          </button>
        </div>
      )}

      {/* Dove lo storico finisce e cominciano le impostazioni: la riga dice
          che quello che si è appena letto vive su QUESTO telefono. */}
      <p className="px-5 mt-4 text-[10px] leading-relaxed" style={{ color:sub }}>{t.notificheLocali}</p>
    </div>
  );
}
