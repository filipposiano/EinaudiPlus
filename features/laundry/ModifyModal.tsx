import { X } from "lucide-react";
import { TIME_SLOTS, DAYS_DATE, monShort } from "../../modello";
import { T, type Lang } from "../../i18n";
import { pianoDi, colorePiano } from "../../piani";
import { RED, RED_FG, OOS_T } from "../../tema";

// ─── ModifyModal (modifica/elimina prenotazione esistente) ─────────────────────

export interface ModifyTarget { dayIdx: number; slotIdx: number; machineId: string; currentRoom: string; }

export function ModifyModal({ target, lang, onEdit, onDelete, onClose }: {
  target: ModifyTarget; isDark: boolean; lang: Lang;
  onEdit: () => void; onDelete: () => void; onClose: () => void;
}) {
  const t    = T[lang];
  const slot = TIME_SLOTS[target.slotIdx];
  const bg   = "var(--background)";
  const fg   = "var(--foreground)";
  const sub  = "var(--gray-accessible-text)";
  const chip = "var(--secondary)";

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl p-6 pb-8 max-h-[92%] overflow-y-auto overscroll-contain" style={{ background:bg }} onClick={(e)=>e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-mono" style={{ color:sub }}>
            {t.days[target.dayIdx]} {DAYS_DATE[target.dayIdx]} {monShort(target.dayIdx, t.mesiBrevi)} · {t.lavBreve} {target.machineId[2]}
          </p>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color:sub, background:chip }}><X size={14}/></button>
        </div>
        <p className="text-lg font-bold mb-1" style={{ color:fg }}>{slot.start} – {slot.end}</p>
        <p className="text-sm mb-6 flex items-center gap-1.5 flex-wrap" style={{ color:sub }}>
          <span>{t.bookedBy(target.currentRoom).replace(target.currentRoom, "")}</span>
          {pianoDi(target.currentRoom) && <span className="size-2 rounded-full shrink-0" style={{ background:colorePiano(pianoDi(target.currentRoom)!) }}/>}
          <span style={{ color:fg, fontWeight:600 }}>{target.currentRoom}</span>
        </p>
        <p className="text-xs mb-3" style={{ color:sub }}>{t.wantModify}</p>
        <div className="flex flex-col gap-2">
          <button onClick={onEdit} className="w-full py-3.5 rounded-2xl text-sm font-semibold" style={{ background:RED, color:RED_FG }}>
            {t.modify}
          </button>
          <button onClick={onDelete} className="w-full py-3.5 rounded-2xl text-sm font-semibold" style={{ background: "color-mix(in srgb, var(--destructive) 10%, transparent)", color: OOS_T }}>
            {t.delete}
          </button>
        </div>
      </div>
    </div>
  );
}
