import { memo, useState } from "react";
import { Printer } from "lucide-react";
import { useMediaQuery } from "../../hooks";
import { BookModal, type BookTarget } from "./BookModal";
import { ModifyModal, type ModifyTarget } from "./ModifyModal";
import { SlotDetailSheet, type SlotDetailTarget } from "./SlotDetailSheet";
import { FoglioSettimana } from "./FoglioSettimana";
import { IntestazioneVista } from "./IntestazioneVista";
import { Toast } from "../../pannelli";
import { TIME_SLOTS, TODAY_DOW, CUR_SLOT, PREV_SLOT, DAYS_DATE, isPastBooking, ORDINE_GIORNI, RANGO_GIORNI, ANTEPRIMA_LUNEDI, type WeekData, type StatusData } from "../../modello";
import { T, errMsg, type Lang } from "../../i18n";
import { pianoDi, colorePiano } from "../../piani";
import { RED, RED_FG, ORANGE, type Theme } from "../../tema";

// ─── Week Overview ─────────────────────────────────────────────────────────────

export const WeekOverview = memo(function WeekOverview({ lang, week, status, roomNumber: sessionRoom, onBook, onClear, isAdmin, onScreen }: {
  theme: Theme; lang: Lang; week: WeekData; status: StatusData; roomNumber: string;
  onBook: (day:number, slot:number, machine:string, room:string)=>Promise<void>;
  onClear: (day:number, slot:number, machine:string)=>Promise<void>;
  isAdmin: boolean;
  onScreen: (i: number) => void;
}) {
  const t = T[lang];
  const [target, setTarget]           = useState<BookTarget | null>(null);
  const [modTarget, setModTarget]     = useState<ModifyTarget | null>(null);
  const [slotDetail, setSlotDetail]   = useState<SlotDetailTarget | null>(null);
  const [toast, setToast]             = useState<string | null>(null);
  const [toastUndo, setToastUndo]     = useState<(() => void) | null>(null);
  const [stampaAperta, setStampaAperta] = useState(false);

  const fg  = "var(--foreground)";
  const sub = "var(--gray-accessible-text)";
  const div = "var(--border)";
  const hdr = "var(--muted)";

  // Le colonne si dividono la larghezza disponibile, su qualunque schermo.
  //
  // Su mobile avevano larghezza fissa (68px) e la griglia scorreva in
  // orizzontale: sette giorni da 68 più la colonna delle ore fanno 524px, e su
  // un telefono da 375 restavano fuori sabato e DOMENICA. Fuori dallo schermo,
  // senza niente che lo dicesse: la settimana sembrava finire il venerdì, e la
  // domenica la trovava solo chi provava a trascinare per curiosità. È il
  // giorno in cui la lavanderia è più libera, per giunta.
  //
  // Adesso i sette giorni ci stanno sempre. Il prezzo è che su 375px ogni
  // colonna vale ~48px e le pastiglie con la camera sono piccole — ma una
  // pastiglia piccola si legge, un giorno fuori schermo no.
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // La colonna delle ore si stringe su mobile: ogni pixel che le si toglie è
  // un pixel che va ai giorni, ed è la parte che si legge meno.
  const TIME_W = isDesktop ? 60 : 38;
  const ROW_H  = isDesktop ? 76 : 60;

  const dayCol = { flex: "1 1 0", minWidth: 0 } as const;

  const fsDay   = isDesktop ? "text-[11px]" : "text-[9px]";
  const fsSlot  = isDesktop ? "text-[11px]" : "text-[9px]";
  const fsChip  = isDesktop ? "text-[11px]" : "text-[8px]";

  async function confirmBooking(room: string) {
    if (!target) return;
    const ti = target; const d = ti.dayIdx ?? TODAY_DOW;
    setTarget(null);
    try {
      if (week[d]?.[ti.slotIdx]?.[ti.machineId]) await onClear(d, ti.slotIdx, ti.machineId);
      await onBook(d, ti.slotIdx, ti.machineId, room);
      setToast(t.slotConfirmed);
      setToastUndo(() => () => { onClear(d, ti.slotIdx, ti.machineId).catch((e) => setToast(errMsg(e, lang))); });
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

  async function deleteFromDetail(dayIdx: number, slotIdx: number, mid: string) {
    const room = week[dayIdx]?.[slotIdx]?.[mid];
    setSlotDetail(null);
    try {
      await onClear(dayIdx, slotIdx, mid);
      setToast(t.slotDeleted);
      setToastUndo(room ? () => () => { onBook(dayIdx, slotIdx, mid, room).catch((e) => setToast(errMsg(e, lang))); } : null);
    }
    catch (e) { setToast(errMsg(e, lang)); setToastUndo(null); }
  }

  // Nessun tetto di larghezza: la griglia ha sette colonne e piu' spazio ha,
  // piu' e' leggibile. Limitandola qui, il contenitore esterno resterebbe
  // vuoto ai lati — che era esattamente il problema.
  return (
    <div className="flex flex-col h-full w-full">
      {toast      && <Toast msg={toast} onClose={()=>{setToast(null); setToastUndo(null);}} undo={toastUndo ? { label: t.cancel, onUndo: toastUndo } : undefined}/>}
      {target     && <BookModal target={target} bookings={week} status={status} isDark={false} lang={lang} myRoom={sessionRoom} isAdmin={isAdmin} onConfirm={confirmBooking} onClose={()=>setTarget(null)}/>}
      {modTarget  && (
        <ModifyModal
          target={modTarget} isDark={false} lang={lang}
          onEdit={()=>{ setTarget({ slotIdx:modTarget.slotIdx, machineId:modTarget.machineId, dayIdx:modTarget.dayIdx, prefillRoom:modTarget.currentRoom }); setModTarget(null); }}
          onDelete={deleteBooking}
          onClose={()=>setModTarget(null)}
        />
      )}
      {slotDetail && (
        <SlotDetailSheet
          target={slotDetail}
          bookings={week}
          isDark={false}
          lang={lang}
          roomNumber={sessionRoom}
          isPast={isPastBooking({ day: slotDetail.dayIdx, slot: slotDetail.slotIdx, mid: "" })}
          onBook={(mid)=>{ setTarget({ dayIdx:slotDetail.dayIdx, slotIdx:slotDetail.slotIdx, machineId:mid }); setSlotDetail(null); }}
          onModify={(mid, room)=>{ setModTarget({ dayIdx:slotDetail.dayIdx, slotIdx:slotDetail.slotIdx, machineId:mid, currentRoom:room }); setSlotDetail(null); }}
          onDelete={(mid)=>{ deleteFromDetail(slotDetail.dayIdx, slotDetail.slotIdx, mid); }}
          onClose={()=>setSlotDetail(null)}
        />
      )}

      {stampaAperta && (
        <FoglioSettimana lang={lang} week={week} onClose={() => setStampaAperta(false)} />
      )}

      {/* Il foglio da appendere, per chi amministra — come quello della sala
          polivalente, e per lo stesso motivo: se l'app non risponde, in
          portineria la settimana deve esistere anche su carta. Non e' aperto
          a tutti perche' e' quello il caso d'uso; i dati sono gli stessi che
          la griglia qui sotto mostra gia' a chiunque. Vive nell'azione della
          nuova intestazione, accanto al "torna alla dashboard". */}
      <IntestazioneVista lang={lang} screen={2} onScreen={onScreen} titolo={t.overview}
        azione={isAdmin && (
          <button onClick={() => setStampaAperta(true)} aria-label="Stampa o esporta la settimana"
            className="p-2 rounded-xl shrink-0" style={{ background:"var(--secondary)", color:sub }}>
            <Printer size={16}/>
          </button>
        )}/>

      <div className="flex-1 overflow-auto">
        <div style={{ width: "100%" }}>

          <div className="flex" style={{ position:"sticky", top:0, zIndex:3, background:hdr, borderBottom:`1px solid ${div}` }}>
            <div style={{ width:TIME_W, flexShrink:0, position:"sticky", left:0, zIndex:4, background:hdr }}
              className="flex items-end justify-center pb-2">
              <span className={`${fsDay} font-mono uppercase`} style={{ color:sub }}>{t.now}</span>
            </div>
            {ORDINE_GIORNI.map((giorno) => {
              const isToday = giorno===TODAY_DOW;
              const isPast  = RANGO_GIORNI[giorno]<RANGO_GIORNI[TODAY_DOW];
              // Il lunedì spostato in fondo durante l'anteprima è l'unico
              // giorno la cui data non segue in ordine quella prima: lo dice
              // anche a parole, non solo con la posizione, perché una griglia
              // che scorre in orizzontale sul telefono può nascondere che
              // l'ultima colonna non è "domenica + 1".
              const prossima = giorno===0 && ANTEPRIMA_LUNEDI;
              return (
                <div key={giorno} className="flex flex-col items-center py-2 gap-0.5" style={dayCol}>
                  <span className={`${fsDay} font-mono uppercase`} style={{ color:prossima?ORANGE:isToday?RED:isPast?`color-mix(in srgb, var(--muted-foreground) 40%, transparent)`:sub }}>{t.days[giorno]}</span>
                  <div className={`${isDesktop ? "w-8 h-8" : "w-7 h-7"} rounded-full flex items-center justify-center`} style={{ background:isToday?RED:"transparent" }}>
                    <span className="text-sm font-bold" style={{ color:prossima?ORANGE:isToday?RED_FG:isPast?`color-mix(in srgb, var(--muted-foreground) 40%, transparent)`:sub }}>{DAYS_DATE[giorno]}</span>
                  </div>
                  {prossima && (
                    <span className={`${isDesktop ? "text-[9px]" : "text-[7px]"} font-bold uppercase tracking-wide text-center leading-none`} style={{ color:ORANGE }}>
                      {t.prossimaSettimana}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {TIME_SLOTS.map((slot, si) => (
            <div key={slot.start} className="flex" style={{ borderBottom:`1px solid ${div}` }}>
              <div style={{ width:TIME_W, flexShrink:0, position:"sticky", left:0, zIndex:1, background:hdr, minHeight:ROW_H }}
                className="flex items-start justify-end pr-2 pt-1.5">
                <span className={`${fsSlot} font-mono tabular-nums`} style={{ color:sub }}>{slot.start}</span>
              </div>

              {ORDINE_GIORNI.map((dayIdx) => {
                const dayData  = week[dayIdx] ?? {};
                const slotData = dayData[si] ?? {};
                const rooms    = Object.entries(slotData);
                const isToday  = dayIdx===TODAY_DOW;
                const isPastDay= RANGO_GIORNI[dayIdx]<RANGO_GIORNI[TODAY_DOW];
                const isCur    = isToday && si===CUR_SLOT;
                const isPrevSl = isToday && si===PREV_SLOT;
                const isPast   = isPastDay || (isToday && si<CUR_SLOT);
                // Un turno passato resta apribile solo se c'e' gia' qualcuno
                // dentro: e' l'unico modo di raggiungere "Elimina" da questa
                // vista per un turno che non c'e' piu' nell'elenco attivo
                // della Dashboard. Una cella passata e vuota invece non porta
                // a niente: non si puo' prenotare nel passato.
                const apribile = !isPast || rooms.length > 0;

                return (
                  <button key={dayIdx}
                    onClick={()=>{ if(apribile) setSlotDetail({ dayIdx, slotIdx:si }); }}
                    className={`relative flex flex-col justify-start pt-1 gap-0.5 text-left transition-colors border-l ${isDesktop ? "px-1.5 hover:brightness-95" : "px-1"}`}
                    style={{ ...dayCol, minHeight:ROW_H, background:isCur?`color-mix(in srgb, var(--primary) 8%, transparent)`:isPrevSl?`color-mix(in srgb, var(--chart-4) 5%, transparent)`:"transparent", borderColor:div, opacity:isPast?0.38:1, cursor:apribile?"pointer":"default" }}>
                    {isCur    && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background:RED }}/>}
                    {isPrevSl && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background:ORANGE }}/>}
                    {rooms.map(([mid, room]) => {
                      const isMe = !!sessionRoom && room === sessionRoom;
                      // Vedi DaySchedule: anche sulla propria camera si vede
                      // il piano, molto piu' saturo, invece del rosso pieno
                      // che si confondeva col resto dell'app. Il rosso resta
                      // solo dove non c'e' un piano riconoscibile.
                      const piano = pianoDi(room);
                      return (
                        <div key={mid} className={`rounded-md flex items-center gap-1 w-full border ${isDesktop ? "px-1.5 py-1" : "px-1 py-0.5"}`}
                          style={{
                            // Mescolato col bianco (vedi DaySchedule): resta un
                            // pastello chiaro qualunque sia il colore del piano
                            // o il tema, cosi' il numero nero sotto si legge
                            // sempre — mescolato con var(--secondary) restava
                            // scuro in tema scuro, e il nero ci si perdeva.
                            background: piano ? `color-mix(in srgb, ${colorePiano(piano)} ${isMe?72:32}%, white)` : isMe ? RED : "var(--secondary)",
                            borderColor: piano ? colorePiano(piano) : isMe ? RED : "var(--border)",
                          }}>
                          <span className={`${fsChip} font-mono font-bold shrink-0`} style={{ color:piano?"#111":isMe?RED_FG:sub }}>{mid[2]}</span>
                          {/* Nero, non il colore del piano: colorato si leggeva
                              male sui piani chiari (il giallo su se stesso). */}
                          <span className={`${fsChip} font-mono truncate`} style={{ color:piano?"#111":isMe?RED_FG:fg }}>{room}</span>
                        </div>
                      );
                    })}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
