import { memo, useState } from "react";
import { Star, Plus } from "lucide-react";
import { WashingMachine } from "../../icons";
import { BookModal, type BookTarget } from "./BookModal";
import { ModifyModal, type ModifyTarget } from "./ModifyModal";
import { IntestazioneVista } from "./IntestazioneVista";
import { Toast } from "../../pannelli";
import { TIME_SLOTS, TODAY_DOW, CUR_SLOT, PREV_SLOT, DAYS_DATE, machinesFor, ORDINE_GIORNI, RANGO_GIORNI, ANTEPRIMA_LUNEDI, type WeekData, type StatusData, type Fav } from "../../modello";
import { T, errMsg, type Lang } from "../../i18n";
import { pianoDi, colorePiano } from "../../piani";
import { RED, RED_FG, ORANGE, ORANGE_T, type Theme } from "../../tema";

// ─── Day Schedule ──────────────────────────────────────────────────────────────

export const DaySchedule = memo(function DaySchedule({ lang, week, status, roomNumber: sessionRoom, favs, onToggleFav, onBook, onClear, isAdmin, onScreen }: {
  theme: Theme; lang: Lang; week: WeekData; status: StatusData; roomNumber: string;
  favs: Fav[]; onToggleFav: (day:number, slot:number)=>void;
  onBook: (day:number, slot:number, machine:string, room:string)=>Promise<void>;
  onClear: (day:number, slot:number, machine:string)=>Promise<void>;
  isAdmin: boolean;
  onScreen: (i: number) => void;
}) {
  const t = T[lang];
  const [selDay, setSelDay]       = useState(TODAY_DOW);
  const [target, setTarget]       = useState<BookTarget | null>(null);
  const [modTarget, setModTarget] = useState<ModifyTarget | null>(null);
  const [toast, setToast]         = useState<string | null>(null);
  const [toastUndo, setToastUndo] = useState<(() => void) | null>(null);

  const sub = "var(--gray-accessible-text)";
  const hdr = "var(--muted)";
  const div = "var(--border)";
  const dayData = week[selDay] ?? {};

  const washIds = machinesFor(sessionRoom).washers;

  async function confirmBooking(room: string) {
    if (!target) return;
    const ti = target;
    setTarget(null);
    try {
      if (week[selDay]?.[ti.slotIdx]?.[ti.machineId]) await onClear(selDay, ti.slotIdx, ti.machineId);
      await onBook(selDay, ti.slotIdx, ti.machineId, room);
      setToast(t.slotConfirmed);
      setToastUndo(() => () => { onClear(selDay, ti.slotIdx, ti.machineId).catch((e) => setToast(errMsg(e, lang))); });
    } catch (e) { setToast(errMsg(e, lang)); setToastUndo(null); }
  }

  async function deleteBooking() {
    if (!modTarget) return;
    const mt = modTarget;
    setModTarget(null);
    try {
      await onClear(mt.dayIdx, mt.slotIdx, mt.machineId);
      setToast(t.slotDeleted);
      setToastUndo(() => () => { onBook(mt.dayIdx, mt.slotIdx, mt.machineId, mt.currentRoom).catch((e) => setToast(errMsg(e, lang))); });
    }
    catch (e) { setToast(errMsg(e, lang)); setToastUndo(null); }
  }

  // Piu' largo di prima (era 3xl, 768px) ma non a tutta pagina: qui le colonne
  // sono solo le lavatrici, e oltre un certo punto diventano bande vuote.
  return (
    <div className="flex flex-col h-full lg:max-w-5xl lg:mx-auto lg:w-full">
      {toast     && <Toast msg={toast} onClose={()=>{setToast(null); setToastUndo(null);}} undo={toastUndo ? { label: t.cancel, onUndo: toastUndo } : undefined}/>}
      {target    && <BookModal target={{...target,dayIdx:selDay}} bookings={week} status={status} isDark={false} lang={lang} myRoom={sessionRoom} isAdmin={isAdmin} onConfirm={confirmBooking} onClose={()=>setTarget(null)}/>}
      {modTarget && (
        <ModifyModal
          target={modTarget} isDark={false} lang={lang}
          onEdit={()=>{ setTarget({ slotIdx:modTarget.slotIdx, machineId:modTarget.machineId, dayIdx:modTarget.dayIdx, prefillRoom:modTarget.currentRoom }); setModTarget(null); }}
          onDelete={deleteBooking}
          onClose={()=>setModTarget(null)}
        />
      )}

      <IntestazioneVista lang={lang} screen={1} onScreen={onScreen} titolo={t.daily}/>

      <div className="px-5 pb-2 shrink-0">
        <div className="grid grid-cols-7 gap-1">
          {ORDINE_GIORNI.map((giorno) => {
            const isActive = giorno===selDay;
            const isPast   = RANGO_GIORNI[giorno]<RANGO_GIORNI[TODAY_DOW];
            // Vedi WeekView: il lunedì in fondo, durante l'anteprima, è
            // quello della settimana dopo — lo dice anche a parole.
            const prossima = giorno===0 && ANTEPRIMA_LUNEDI;
            return (
              <button key={giorno} onClick={()=>setSelDay(giorno)}
                className="flex flex-col items-center py-1.5 rounded-xl transition-colors"
                style={{ background:isActive?RED:"transparent", color:isActive?RED_FG:prossima?ORANGE:isPast?"color-mix(in srgb, var(--muted-foreground) 40%, transparent)":sub }}>
                <span className="text-[9px] font-mono uppercase leading-none mb-0.5">{t.days[giorno]}</span>
                <span className="text-sm font-bold leading-none">{DAYS_DATE[giorno]}</span>
                {prossima && !isActive && (
                  <span className="text-[6px] font-bold uppercase tracking-wide leading-none mt-0.5" style={{ color:ORANGE }}>
                    {t.prossimaSettimana}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center px-5 py-2 border-b shrink-0" style={{ background:hdr, borderColor:div }}>
        <div className="w-[56px] shrink-0"/>
        {washIds.map((id)=>(
          <div key={id} className="flex-1 flex flex-col items-center gap-0.5">
            <WashingMachine size={11} style={{ color:sub }}/>
            <span className="text-[9px] font-mono" style={{ color:sub }}>{t.lavBreve} {id[2]}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {TIME_SLOTS.map((slot, si) => {
          const isCur  = si===CUR_SLOT  && selDay===TODAY_DOW;
          const isPrev = si===PREV_SLOT && selDay===TODAY_DOW;
          const isPast = RANGO_GIORNI[selDay]<RANGO_GIORNI[TODAY_DOW] || (selDay===TODAY_DOW && si<CUR_SLOT);
          const isFav  = favs.some((f) => f.day === selDay && f.slot === si);
          return (
            <div key={slot.start} className="flex items-center px-5 relative"
              style={{ minHeight:48, background:isCur?`color-mix(in srgb, var(--primary) 8%, transparent)`:isPrev?`color-mix(in srgb, var(--chart-4) 5%, transparent)`:"transparent", borderBottom:`1px solid ${div}` }}>
              {isCur  && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background:RED }}/>}
              {isPrev && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background:ORANGE }}/>}
              <div className="w-[56px] shrink-0 py-2 flex items-start gap-1">
                <div className="min-w-0">
                  <span className="text-[10px] font-mono tabular-nums block" style={{ color:isCur?RED:isPrev?ORANGE_T:sub }}>{slot.start}</span>
                  {isCur  && <span className="text-[8px] font-mono" style={{ color:RED }}>{t.now}</span>}
                  {isPrev && <span className="text-[8px] font-mono" style={{ color:ORANGE_T }}>{t.prev}</span>}
                </div>
                <button onClick={()=>onToggleFav(selDay, si)} className="p-0.5 -mr-1 shrink-0 transition-transform active:scale-90" aria-label="preferito">
                  <Star size={11} style={{ color:isFav?ORANGE:sub, fill:isFav?ORANGE:"none", opacity:isFav?1:0.45 }}/>
                </button>
              </div>
              {washIds.map((mid) => {
                const room = dayData[si]?.[mid];
                const isMe = !!sessionRoom && room === sessionRoom;
                // Anche sulla propria camera si vede il piano: prima era
                // rosso pieno, ma il rosso e' gia' usato ovunque nell'app
                // (bottoni, stato attivo) e sulla riga si confondeva col
                // resto. Il colore del piano, molto piu' saturo che sulle
                // altre camere, distingue la propria senza quell'ambiguita'.
                // Il rosso pieno resta solo per le camere senza piano
                // riconoscibile (es. DIREZIONE), dove non c'e' un colore
                // di piano a cui appoggiarsi.
                const piano = room ? pianoDi(room) : null;
                return (
                  <div key={mid} className="flex-1 px-1 py-1.5">
                    {room ? (
                      // A differenza della cella vuota (sotto), quella occupata
                      // resta cliccabile anche nel passato: e' l'unico modo di
                      // cancellare un turno gia' passato dalla vista giornaliera,
                      // non solo dall'elenco "Le tue prenotazioni" in Dashboard.
                      <button
                        onClick={()=>setModTarget({ dayIdx:selDay, slotIdx:si, machineId:mid, currentRoom:room })}
                        className="w-full h-9 rounded-xl flex items-center justify-center transition-all active:scale-95"
                        style={{
                          // Mescolato col bianco, non con var(--secondary): in
                          // tema scuro var(--secondary) e' gia' scuro, e un blu
                          // o un viola mescolati li' restavano scuri quanto
                          // prima — il numero nero sotto sarebbe stato illeggibile
                          // quanto lo era il giallo chiaro su se stesso. Mescolato
                          // col bianco lo sfondo resta un pastello chiaro qualunque
                          // sia il colore o il tema, e il nero ci si legge sempre.
                          background: piano ? `color-mix(in srgb, ${colorePiano(piano)} ${isMe?72:32}%, white)` : isMe ? RED : "var(--secondary)",
                          border: `1px solid ${piano ? colorePiano(piano) : isMe ? RED : "var(--border)"}`,
                          boxShadow: isMe && !piano ? "0 2px 8px color-mix(in srgb, var(--primary) 35%, transparent)" : "none",
                          opacity: isPast ? 0.6 : 1,
                        }}>
                        {/* Il numero resta nero: colorato si leggeva male
                            proprio sui piani chiari (il giallo su se stesso).
                            A dire "che piano e'" bastano gia' sfondo e bordo. */}
                        <span className="text-[10px] font-mono font-bold" style={{ color:piano?"#111":isMe?RED_FG:sub }}>{room}</span>
                      </button>
                    ) : (
                      <button disabled={isPast}
                        onClick={()=>!isPast && setTarget({ slotIdx:si, machineId:mid })}
                        className="w-full h-9 rounded-xl flex items-center justify-center transition-colors border"
                        style={{ borderColor:"var(--border)", borderStyle:"dashed", background:"transparent", cursor:isPast?"default":"pointer" }}>
                        {!isPast && <Plus size={10} style={{ color:"var(--gray-accessible-text)", opacity:0.6 }}/>}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
});
