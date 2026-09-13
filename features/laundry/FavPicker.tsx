import { useState, useCallback } from "react";
import { X, Star } from "lucide-react";
import RuotaPicker from "../../RuotaPicker";
import { useInvio } from "./hooks";
import { TIME_SLOTS, TODAY_DOW, type Fav } from "../../modello";
import { T, type Lang } from "../../i18n";
import { RED, RED_FG, ORANGE } from "../../tema";

// ─── Popup "Aggiungi preferito": scegli giorno + fascia oraria ──────────────────
export function FavPicker({ lang, favs, onAdd, onRemove, onClose }: {
  lang: Lang; favs: Fav[]; onAdd: (day:number, slot:number)=>void;
  // Toglie un preferito. Il pannello e' anche il posto dove si guarda cos'e'
  // gia' segnato: si chiamava "Aggiungi preferito" e sapeva solo aggiungere —
  // per togliere bisognava uscire, aprire la stella e cercare la riga.
  onRemove: (day:number, slot:number)=>void;
  onClose: ()=>void;
}) {
  const t = T[lang];
  const fg="var(--foreground)", sub="var(--gray-accessible-text)", chip="var(--secondary)";
  const [day, setDay]   = useState(TODAY_DOW);
  const [slot, setSlot] = useState(0);
  const already = favs.some((f) => f.day === day && f.slot === slot);

  useInvio(!already, useCallback(() => onAdd(day, slot), [onAdd, day, slot]));
  return (
    <div className="absolute inset-0 z-50 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      {/* foglio-modale: intestazione e piede fissi, solo il centro scorre. Cosi'
          il pulsante di conferma non finisce mai sotto il bordo. Vedi style.css. */}
      <div className="foglio-modale w-full rounded-t-3xl px-6" style={{ background:"var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="foglio-modale__testa pt-5">
          <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background:"color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
          <div className="flex items-center justify-between mb-4">
            <p className="text-lg font-bold" style={{ color:fg }}>{t.addFav}</p>
            <button onClick={onClose} className="p-2 rounded-xl" style={{ background:chip, color:sub }}><X size={16}/></button>
          </div>
        </div>

        <div className="foglio-modale__corpo">
          <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.day}</p>
          <div className="grid grid-cols-7 gap-1 mb-4">
            {t.days.map((d, i)=>(
              <button key={i} onClick={()=>setDay(i)} className="py-2 rounded-xl text-xs font-semibold transition-colors"
                style={ i===day ? { background:RED, color:RED_FG } : { background:chip, color:sub } }>{d}</button>
            ))}
          </div>

          {/* Ruota al posto di 19 pulsanti su sette righe: stesse fasce in
              170px fissi invece di ~280 che crescono col numero di turni. */}
          <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.timeSlot}</p>
          <RuotaPicker
            valori={TIME_SLOTS.map((s) => `${s.start} – ${s.end}`)}
            indice={slot}
            onCambia={setSlot}
            ariaLabel={t.timeSlot}
          />

          {/* Quelli gia' segnati, in ordine di settimana. Stanno sotto la
              ruota e non sopra: prima si sceglie, poi si controlla — e chi
              apre questo pannello per togliere qualcosa scorre di un dito. */}
          <div className="flex items-center justify-between gap-2 mt-5 mb-2">
            <p className="text-[11px] font-mono tracking-widest uppercase" style={{ color:sub }}>{t.favorites}</p>
            <span className="text-[11px] font-mono tabular-nums" style={{ color:sub }}>{favs.length}</span>
          </div>

          <div className="rounded-2xl overflow-hidden border mb-2" style={{ background:"var(--card)", borderColor:"var(--border)" }}>
            {favs.length === 0 ? (
              <p className="px-4 py-3 text-xs" style={{ color:sub }}>{t.noFavs}</p>
            ) : (
              [...favs].sort((a, b) => a.day - b.day || a.slot - b.slot).map((f, i, arr) => {
                const sl = TIME_SLOTS[f.slot];
                const scelto = f.day === day && f.slot === slot;
                return (
                  <div key={`${f.day}-${f.slot}`} className="flex items-center gap-3 px-4 py-2.5"
                    style={{
                      borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                      // Quello che la ruota sta indicando in questo momento: si
                      // vede che e' gia' fra questi, ed e' il motivo per cui il
                      // pulsante sotto dice "Gia' nei preferiti".
                      background: scelto ? "var(--secondary)" : "transparent",
                    }}>
                    <Star size={14} className="shrink-0" style={{ color:ORANGE, fill:ORANGE }}/>
                    <p className="flex-1 min-w-0 text-sm font-mono font-semibold truncate" style={{ color:fg }}>
                      {t.days[f.day]} · {sl.start}–{sl.end}
                    </p>
                    <button onClick={()=>onRemove(f.day, f.slot)} aria-label={`${t.removeFav}: ${t.days[f.day]} ${sl.start}`}
                      className="p-1.5 rounded-lg shrink-0 transition-transform active:scale-90"
                      style={{ background:chip, color:sub }}>
                      <X size={13}/>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="foglio-modale__piede pb-7 pt-3">
          <button onClick={()=>onAdd(day, slot)} disabled={already}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
            style={{ background:RED, color:RED_FG, opacity: already ? 0.5 : 1 }}>
            <Star size={15}/>{already ? t.favAlready : `${t.addFav} · ${t.days[day]} ${TIME_SLOTS[slot].start}`}
          </button>
        </div>
      </div>
    </div>
  );
}
