import { X, Plus } from "lucide-react";
import { WashingMachine } from "../../icons";
import { TIME_SLOTS, DAYS_DATE, monShort, machinesFor, type WeekData } from "../../modello";
import { T, type Lang } from "../../i18n";
import { pianoDi, colorePiano } from "../../piani";
import { RED, GREEN, GREEN_T, OOS_T } from "../../tema";

// ─── Slot detail sheet (vista settimanale) ────────────────────────────────────

export interface SlotDetailTarget { dayIdx: number; slotIdx: number; }

export function SlotDetailSheet({ target, bookings, lang, roomNumber, isPast, onBook, onModify, onDelete, onClose }: {
  target: SlotDetailTarget;
  bookings: WeekData;
  isDark: boolean;
  lang: Lang;
  roomNumber: string | null;
  // Un turno passato resta apribile per poter cancellare chi lo occupa (vedi
  // WeekOverview), ma le macchine ancora libere in quel turno non diventano
  // prenotabili solo perche' il foglio e' aperto: si potrebbe altrimenti
  // creare una prenotazione nel passato da qui, l'unico varco rimasto aperto.
  isPast?: boolean;
  onBook: (machineId: string) => void;
  onModify: (machineId: string, currentRoom: string) => void;
  onDelete: (machineId: string) => void;
  onClose: () => void;
}) {
  const t        = T[lang];
  const slot     = TIME_SLOTS[target.slotIdx];
  const slotData = bookings[target.dayIdx]?.[target.slotIdx] ?? {};

  const bg       = "var(--background)";
  const fg       = "var(--foreground)";
  const sub      = "var(--gray-accessible-text)";
  const chip     = "var(--secondary)";
  const divC     = "var(--border)";

  const washIds = machinesFor(roomNumber).washers;

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pb-8 max-h-[92%] overflow-y-auto overscroll-contain" style={{ background:bg }} onClick={(e)=>e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 border-b" style={{ borderColor:divC }}>
          <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-mono mb-0.5" style={{ color:sub }}>
                {t.days[target.dayIdx]} {DAYS_DATE[target.dayIdx]} {monShort(target.dayIdx, t.mesiBrevi)}
              </p>
              <p className="text-xl font-mono font-bold" style={{ color:fg }}>{slot.start} – {slot.end}</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl" style={{ color:sub, background:chip }}>
              <X size={16}/>
            </button>
          </div>
        </div>

        <div className="px-6 pt-4 flex flex-col gap-2.5">
          {washIds.map((mid) => {
            const room = slotData[mid];
            const lbl  = mid[2];
            return (
              <div key={mid} className="rounded-2xl px-4 py-3.5 border"
                style={{ background:chip, borderColor:divC }}>
                <div className="flex items-center gap-3">
                  <WashingMachine size={18} style={{ color:room?fg:sub, flexShrink:0 }}/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color:fg }}>{t.washer} {lbl}</p>
                    <p className="text-xs font-mono flex items-center gap-1" style={{ color:room?sub:GREEN_T }}>
                      {room && pianoDi(room) && <span className="size-1.5 rounded-full shrink-0" style={{ background:colorePiano(pianoDi(room)!) }}/>}
                      {room ? `${t.room} ${room}` : t.free}
                    </p>
                  </div>
                  {!room && !isPast && (
                    <button
                      onClick={()=>onBook(mid)}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 shrink-0"
                      style={{ background:`color-mix(in srgb, ${GREEN} 12%, transparent)`, color:GREEN_T }}>
                      <Plus size={11}/>{t.book}
                    </button>
                  )}
                </div>
                {room && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={()=>onModify(mid, room)}
                      className="flex-1 rounded-xl py-2 text-xs font-semibold transition-all active:scale-95"
                      style={{ background:`color-mix(in srgb, var(--primary) 15%, transparent)`, color:RED }}>
                      {t.modify}
                    </button>
                    <button
                      onClick={()=>onDelete(mid)}
                      className="flex-1 rounded-xl py-2 text-xs font-semibold transition-all active:scale-95 border"
                      style={{ background:"transparent", borderColor:"var(--border)", color:OOS_T }}>
                      {t.delete}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
