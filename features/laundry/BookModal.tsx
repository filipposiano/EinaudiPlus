import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, X, Delete, Wind } from "lucide-react";
import { WashingMachine } from "../../icons";
import { useTastieraFisica, TASTI_CAMERA } from "../../hooks";
import { useInvio } from "./hooks";
import * as api from "../../api";
import { TIME_SLOTS, TODAY_DOW, DAYS_DATE, monShort, nextRef, machinesFor, type WeekData, type StatusData } from "../../modello";
import { T, type Lang } from "../../i18n";
import { RED, RED_FG, GREEN_T, OOS_C, OOS_T } from "../../tema";

// ─── BookModal (nuova prenotazione / modifica) ────────────────────────────────

export interface BookTarget { dayIdx?: number; slotIdx: number; machineId: string; prefillRoom?: string; }

export function BookModal({ target, bookings, status = {}, myRoom, lang, isAdmin = false, onConfirm, onClose }: {
  target: BookTarget; bookings: WeekData; status?: StatusData; isDark: boolean;
  myRoom?: string; lang: Lang; isAdmin?: boolean;
  onConfirm: (room: string) => void; onClose: () => void;
}) {
  const t = T[lang];
  const [selMachine, setSelMachine] = useState<string | null>(
    target.machineId !== "?" ? target.machineId : null
  );
  const [room, setRoom] = useState(target.prefillRoom ?? "");

  // `prefillRoom` c'è solo quando si arriva da "Modifica stanza" su una
  // prenotazione che esiste già. Lì la domanda "per chi è?" è fuori luogo: la
  // risposta è "per qualcun altro" per definizione — se fosse la tua non
  // staresti cambiando il numero — e costringeva a un tocco in più per
  // arrivare al tastierino, che è l'unica cosa che si voleva aprire.
  const daModifica = target.prefillRoom !== undefined;
  const firstStep =
    target.machineId === "?" ? "pick"
    : daModifica              ? "input"
    : myRoom                  ? "owner"
    : "input";
  const [step, setStep] = useState<"pick"|"owner"|"input"|"confirm">(firstStep);

  const slot      = TIME_SLOTS[target.slotIdx];
  const dayIdx    = target.dayIdx ?? TODAY_DOW;
  const taken     = new Set(Object.keys(bookings[dayIdx]?.[target.slotIdx] ?? {}));

  const bg   = "var(--background)";
  const fg   = "var(--foreground)";
  const sub  = "var(--gray-accessible-text)";
  const chip = "var(--secondary)";
  const machLabel = selMachine?.split("-")[1] ?? "";
  // Chi risulta intestatario del turno: una camera, o la Direzione.
  const intestatario = room === api.DIREZIONE ? t.direzioneNome : `${t.room} ${room}`;

  // Il turno di asciugatrice che viene insieme alla lavatrice. Passa da
  // nextRef e non da `slotIdx + 1` perché l'ultimo turno del giorno consegna
  // al primo del giorno dopo, e scriverlo a mano qui avrebbe sballato
  // l'orario proprio nel caso in cui serve saperlo di più.
  const rifAsciugatrice   = nextRef(dayIdx, target.slotIdx);
  const slotAsciugatrice  = TIME_SLOTS[rifAsciugatrice.slot];
  const asciugaturaDomani = rifAsciugatrice.day !== dayIdx;
  const surfConferma      = "var(--card)";

  /**
   * La camera digitata appartiene all'altro edificio.
   *
   * Si valuta a ogni cifra, ma NON si mostra mentre si scrive: chi digita
   * "215" passa per "2" e "21", che sono numeri della Manica, e l'avviso
   * compariva e spariva sotto le dita spostando tutto il modale. Un avviso che
   * lampeggia mentre stai ancora scrivendo non ti sta dicendo niente: ti sta
   * solo dando torto in anticipo.
   *
   * Compare quando si prova ad andare avanti, ed è lì che serve.
   */
  const altraLavanderia =
    !!myRoom && myRoom !== api.DIREZIONE && room.length > 0 && !api.sameLaundry(myRoom, room);

  const [avvisoLavanderia, setAvvisoLavanderia] = useState(false);

  // Ricominciando a scrivere l'avviso se ne va: il numero che l'aveva
  // provocato non è più quello sullo schermo.
  useEffect(() => { setAvvisoLavanderia(false); }, [room]);

  /** Avanti dal tastierino: o si prosegue, o si dice perché no. */
  function avanti() {
    if (room.length === 0) return;
    if (altraLavanderia) { setAvvisoLavanderia(true); return; }
    setStep("confirm");
  }

  // Prenotando una lavatrice si riserva anche l'asciugatrice con la stessa
  // lettera per il turno successivo: se una delle due è segnalata guasta, chi
  // prenota deve saperlo PRIMA, non scoprirlo davanti alla macchina.
  const oosDi = (id: string) => status[id] === "oos";
  const washerOos = selMachine ? oosDi(selMachine) : false;
  const dryerOos  = selMachine ? oosDi("D-" + selMachine[2]) : false;
  const avviso = washerOos || dryerOos;

  // Anche questo tastierino si scrive da tastiera, non solo quello della
  // schermata camera. Attivo SOLO nel passo "input": negli altri passi i tasti
  // non hanno un campo dove andare, e Invio finirebbe per confermare qualcosa
  // che l'utente non sta guardando.
  useTastieraFisica(
    step === "input",
    setRoom,
    avanti,
    4,
    TASTI_CAMERA,
  );

  // Nel passo "conferma" invece Invio ha un bersaglio solo, ed e' quello che
  // l'utente sta guardando: il pulsante rosso.
  useInvio(step === "confirm", useCallback(() => onConfirm(room), [onConfirm, room]));

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl p-6 pb-8 max-h-[92%] overflow-y-auto overscroll-contain" style={{ background:bg }} onClick={(e)=>e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-xs font-mono mb-0.5" style={{ color:sub }}>{t.days[dayIdx]} {DAYS_DATE[dayIdx]} {monShort(dayIdx, t.mesiBrevi)}</p>
            <p className="text-lg font-mono font-bold" style={{ color:fg }}>{slot.start} – {slot.end}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl" style={{ color:sub, background:chip }}><X size={16}/></button>
        </div>

        {/* Avviso guasto: resta visibile per tutti i passaggi successivi alla
            scelta, così non lo si perde passando all'inserimento camera. */}
        {avviso && step !== "pick" && (
          <div className="rounded-2xl p-3.5 mb-5 flex gap-3"
            style={{ background:`color-mix(in srgb, ${OOS_C} 10%, transparent)`, border:`1px solid ${OOS_C}` }}>
            <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color:OOS_T }}/>
            <div className="min-w-0">
              <p className="text-sm font-semibold mb-0.5" style={{ color:OOS_T }}>{t.oosWarnTitle}</p>
              <p className="text-xs leading-snug" style={{ color:fg }}>
                {washerOos && t.oosWasherWarn(machLabel)}
                {washerOos && dryerOos && " "}
                {dryerOos && t.oosDryerWarn(machLabel)}
              </p>
              <p className="text-xs leading-snug mt-1" style={{ color:sub }}>{t.oosWarnBody}</p>
            </div>
          </div>
        )}

        {step === "pick" && (
          <>
            <p className="text-sm font-semibold mb-3" style={{ color:fg }}>{t.chooseFree}</p>
            <div className="flex gap-3 mb-4">
              {machinesFor(myRoom).washers.map((id) => {
                const isTaken = taken.has(id);
                // Guasta la lavatrice, oppure l'asciugatrice che verrebbe
                // riservata insieme: in entrambi i casi va segnalato qui.
                const rotta = oosDi(id) || oosDi("D-" + id[2]);
                return (
                  <button key={id} disabled={isTaken}
                    onClick={() => { setSelMachine(id); setStep("input"); }}
                    className="flex-1 flex flex-col items-center gap-2 rounded-2xl py-4 transition-all active:scale-95 border"
                    style={{
                      background: rotta && !isTaken ? `color-mix(in srgb, ${OOS_C} 8%, transparent)` : chip,
                      borderColor: isTaken ? "transparent" : rotta ? OOS_C : "var(--border)",
                      opacity: isTaken ? 0.32 : 1,
                      cursor: isTaken ? "not-allowed" : "pointer",
                    }}>
                    <WashingMachine size={22} style={{ color:isTaken?sub:rotta?OOS_T:fg }}/>
                    <span className="text-sm font-bold font-mono" style={{ color:isTaken?sub:fg }}>{t.lavBreve} {id[2]}</span>
                    <span className="text-[10px] flex items-center gap-1"
                      style={{ color: isTaken ? sub : rotta ? OOS_T : GREEN_T }}>
                      {rotta && !isTaken && <AlertTriangle size={10}/>}
                      {isTaken ? t.occupied : rotta ? t.oos : t.free}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === "owner" && myRoom && (
          <>
            <p className="text-sm font-semibold mb-1" style={{ color:fg }}>{t.whoIsIt}</p>
            <p className="text-xs mb-5" style={{ color:sub }}>{t.washer} {machLabel} · {slot.start} – {slot.end}</p>
            <div className="flex flex-col gap-3 mb-2">
              <button
                onClick={()=>{ setRoom(myRoom); setStep("confirm"); }}
                className="w-full py-4 rounded-2xl text-sm font-semibold flex items-center justify-between px-5 transition-all active:scale-[0.98]"
                style={{ background:RED, color:RED_FG }}>
                {/* La Direzione non è una camera: "Per me — Camera DIREZIONE"
                    non vorrebbe dire niente. */}
                <span>{myRoom === api.DIREZIONE ? t.forDirezione : t.forMe(myRoom)}</span>
                <span style={{ opacity:0.7 }}>→</span>
              </button>
              <button
                onClick={()=>setStep("input")}
                className="w-full py-4 rounded-2xl text-sm font-semibold flex items-center justify-between px-5 transition-all active:scale-[0.98]"
                style={{ background:chip, color:fg }}>
                <span>{t.forOther}</span>
                <span style={{ color:sub }}>→</span>
              </button>
              {/* Visibile solo con una sessione amministrativa, e solo se
                  l'identità corrente non è già la Direzione: altrimenti sarebbe
                  un doppione del pulsante qui sopra. Nasconderlo non e'
                  un'autorizzazione: il server rifiuta comunque senza cookie. */}
              {isAdmin && myRoom !== api.DIREZIONE && (
                <button
                  onClick={()=>{ setRoom(api.DIREZIONE); setStep("confirm"); }}
                  className="w-full py-4 rounded-2xl text-sm font-semibold flex items-center justify-between px-5 transition-all active:scale-[0.98] border"
                  style={{ background:"transparent", borderColor:RED, color:RED }}>
                  <span>{t.forDirezione}</span>
                  <span style={{ opacity:0.7 }}>→</span>
                </button>
              )}
            </div>
          </>
        )}

        {step === "input" && (
          <>
            <p className="text-sm font-semibold mb-4" style={{ color:fg }}>{t.washer} {machLabel} · {t.insertRoom}</p>
            <div className="rounded-2xl px-5 py-4 mb-4 flex items-center justify-between" style={{ background:"var(--muted)" }}>
              <span className="text-sm font-mono" style={{ color:sub }}>{t.room}</span>
              <span className="text-3xl font-mono font-bold tabular-nums" style={{ color:room?fg:sub }}>{room||"—"}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {/* Forma funzionale: due tocchi ravvicinati leggerebbero
                  entrambi lo stesso valore e perderebbero una cifra. */}
              {["1","2","3","4","5","6","7","8","9"].map((k)=>(
                <button key={k} onClick={()=>setRoom(r=>r.length<4?r+k:r)}
                  className="rounded-2xl h-12 text-lg font-bold transition-all active:scale-95"
                  style={{ background:chip, color:fg }}>{k}</button>
              ))}
              <button onClick={()=>setRoom(r=>r.slice(0,-1))}
                className="rounded-2xl h-12 flex items-center justify-center transition-all active:scale-95"
                style={{ background:chip, color:sub }}><Delete size={18}/></button>
              <button onClick={()=>setRoom(r=>r.length<4?r+"0":r)}
                className="rounded-2xl h-12 text-lg font-bold transition-all active:scale-95"
                style={{ background:chip, color:fg }}>0</button>
              <button onClick={avanti}
                className="rounded-2xl h-12 text-lg font-bold transition-all active:scale-95"
                style={{ background:room.length>0?RED:chip, color:room.length>0?RED_FG:sub }}>→</button>
            </div>

            {/* Le due lavanderie sono edifici separati: prenotare una macchina
                dove non si abita non ha senso, e prima corrompeva pure la
                schermata (si finiva a vedere la griglia dell'altro edificio).
                Il rifiuto vero è sul server; qui si dice perché, prima di far
                battere il numero a vuoto. */}
            {avvisoLavanderia && (
              <p className="text-xs mb-3 px-1 flex items-start gap-1.5" style={{ color:OOS_T }}>
                <AlertTriangle size={13} style={{ flexShrink:0, marginTop:1 }}/>
                {t.altraLavanderia}
              </p>
            )}

            {/* Da "Modifica stanza" non c'è un passo precedente a cui tornare:
                il tastierino è il primo. Indietro qui chiude e basta. */}
            {daModifica ? (
              <button onClick={onClose} className="text-xs" style={{ color:sub }}>{t.back}</button>
            ) : (target.machineId === "?" || myRoom) && (
              <button onClick={()=>setStep(target.machineId==="?"?"pick":myRoom?"owner":"input")} className="text-xs" style={{ color:sub }}>{t.back}</button>
            )}
          </>
        )}

        {step === "confirm" && (
          <>
            <p className="text-sm font-semibold mb-1" style={{ color:fg }}>{t.confirmBooking}</p>
            {/* "Camera DIREZIONE" non esiste: la Direzione prenota per la
                struttura, non per una stanza. */}
            <p className="text-xs mb-4" style={{ color:sub }}>{intestatario} · {t.washer} {machLabel}</p>
            <div className="rounded-2xl overflow-hidden mb-5 border" style={{ borderColor: "var(--border)" }}>
              <div className="p-4 flex items-center gap-3" style={{ background: "color-mix(in srgb, var(--primary) 12%, transparent)" }}>
                <div className="p-2.5 rounded-xl" style={{ background:RED, color:RED_FG }}><WashingMachine size={18}/></div>
                <div>
                  <p className="text-xs font-mono mb-0.5" style={{ color:sub }}>{t.washer} {machLabel} · {intestatario}</p>
                  <p className="text-base font-mono font-bold" style={{ color:fg }}>{slot.start} – {slot.end}</p>
                </div>
              </div>
              {/* L'asciugatrice non si prenota: è di chi ha avuto la lavatrice
                  nel turno prima (vedi deriveMachines). Era una regola vera
                  ma invisibile — le stringhe per dirla esistevano tradotte in
                  sei lingue e non erano renderizzate da nessuna parte. Qui
                  diventa parte di ciò che si sta confermando, con l'orario
                  esatto: chi prenota alle 22:00 deve sapere che il bucato va
                  spostato alle 23:15, non "dopo". */}
              <div className="p-4 flex items-center gap-3 border-t" style={{ borderColor:"var(--border)", background:surfConferma }}>
                <div className="p-2.5 rounded-xl" style={{ background:chip, color:sub }}><Wind size={18}/></div>
                <div className="min-w-0">
                  <p className="text-xs font-mono mb-0.5" style={{ color:sub }}>{t.dryer} {machLabel} · {t.autoReservedLabel}</p>
                  <p className="text-base font-mono font-bold" style={{ color:fg }}>
                    {slotAsciugatrice.start} – {slotAsciugatrice.end}
                    {asciugaturaDomani && <span className="text-xs font-sans font-normal" style={{ color:sub }}> {t.giornoDopo}</span>}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setStep("input")} className="flex-1 py-3.5 rounded-2xl text-sm font-semibold" style={{ background:chip, color:fg }}>{t.backModify}</button>
              <button onClick={()=>onConfirm(room)} className="flex-1 py-3.5 rounded-2xl text-sm font-semibold" style={{ background:RED, color:RED_FG }}>{t.confirm}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
