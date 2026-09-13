import { useState } from "react";
import { X, Loader2, AlertTriangle, Plus } from "lucide-react";
import { WashingMachine } from "../../icons";
import { TIME_SLOTS, machinesFor, bookingAt, type WeekData, type StatusData } from "../../modello";
import { T, errMsg, type Lang } from "../../i18n";
import { RED, RED_FG, GREEN, YELLOW, OOS_C, OOS_T, GREEN_T } from "../../tema";

// ─── Modale scelta lavatrice (da un turno preferito) ────────────────────────────
export function QuickBookModal({ lang, day, slot, week, status, roomNumber, onBook, onClose }: {
  lang: Lang; day: number; slot: number; week: WeekData; status: StatusData; roomNumber: string | null;
  onBook: (day:number, slot:number, mid:string)=>Promise<void>; onClose: ()=>void;
}) {
  const t = T[lang];
  const fg="var(--foreground)", sub="var(--gray-accessible-text)", div="var(--border)", surf="var(--card)";
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const sl = TIME_SLOTS[slot];

  const washers = machinesFor(roomNumber).washers.map((wid) => {
    const L = wid[2];
    const oos = status[wid] === "oos";
    const room = bookingAt(week, day, slot, wid);
    // Guasta ma libera resta prenotabile: chi vuole rischiare può farlo, il
    // banner sotto glielo dice esplicitamente prima che tocchi "Prenota".
    return { L, wid, oos, room, free: !room };
  });
  const anyFree = washers.some((w) => w.free);
  const anyOosFree = washers.some((w) => w.free && w.oos);

  async function book(wid: string) {
    if (busy) return;
    setBusy(wid); setErr(null);
    try { await onBook(day, slot, wid); onClose(); }
    catch (e) { setErr(errMsg(e, lang)); setBusy(null); }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pt-5 pb-7 px-6 max-h-[92%] overflow-y-auto overscroll-contain" style={{ background:"var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background:"color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        <div className="flex items-center justify-between mb-1">
          <p className="text-lg font-bold" style={{ color:fg }}>{t.chooseWasher}</p>
          <button onClick={onClose} className="p-2 rounded-xl" style={{ background:"var(--secondary)", color:sub }}><X size={16}/></button>
        </div>
        <p className="text-sm font-mono mb-4" style={{ color:sub }}>{t.days[day]} · {sl.start}–{sl.end}</p>

        <div className="rounded-2xl overflow-hidden border mb-3" style={{ background:surf, borderColor:div }}>
          {washers.map((w, i) => {
            const dot = w.oos ? OOS_C : w.free ? GREEN : YELLOW;
            const statusText = w.oos ? t.oos : w.free ? t.free : `${t.room} ${w.room}`;
            return (
              <div key={w.L} className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: i < washers.length - 1 ? `1px solid ${div}` : "none" }}>
                <span className="size-2 rounded-full shrink-0" style={{ background:dot }}/>
                <WashingMachine size={17} style={{ color:fg }}/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight" style={{ color:fg }}>{t.washer} {w.L}</p>
                  <p className="text-xs leading-tight truncate" style={{ color: w.oos ? OOS_T : w.free ? GREEN_T : sub }}>{statusText}</p>
                </div>
                {w.free
                  ? <button onClick={()=>book(w.wid)} disabled={!!busy}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 shrink-0"
                      style={{
                        background: w.oos ? OOS_C : RED,
                        color: w.oos ? "var(--destructive-foreground)" : RED_FG,
                        opacity: busy && busy!==w.wid ? 0.5 : 1,
                      }}>
                      {busy===w.wid ? <Loader2 size={12} className="animate-spin-slow"/>
                        : w.oos ? <AlertTriangle size={12}/> : <Plus size={12}/>}
                      {w.oos ? t.bookAnyway : t.book}
                    </button>
                  : <span className="text-xs font-medium shrink-0" style={{ color:sub }}>{t.favFull}</span>}
              </div>
            );
          })}
        </div>

        {anyOosFree && (
          <p className="text-xs text-center mb-2 flex items-center justify-center gap-1.5" style={{ color:OOS_T }}>
            <AlertTriangle size={12} className="shrink-0"/>{t.oosWarnBody}
          </p>
        )}
        {!anyFree && <p className="text-xs text-center" style={{ color:sub }}>{t.noFreeWashers}</p>}
        {err && <p className="text-xs text-center" style={{ color:OOS_T }}>{err}</p>}
      </div>
    </div>
  );
}
