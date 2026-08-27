import { useState, useEffect, useCallback, useRef, memo, lazy, Suspense } from "react";
import {
  Wind, Clock, CalendarDays,
  Plus, CheckCircle2, AlertTriangle,
  LayoutGrid, Delete, X, Wrench, Loader2, Star,
  History, Trash2, Film, Music, Menu,
  MessageSquare, Send, LogOut, Printer, Download,
  Settings, Repeat, Eraser, Presentation, UserCog,
} from "lucide-react";
import * as api from "./api";
import * as push from "./push";
import RoomView from "./Rooms";
// La ruota la usa ancora il popup dei preferiti (giorno + fascia oraria).
import RuotaPicker from "./RuotaPicker";
import Conferenze from "./Conferenze";
import AccessibilityPanel from "./AccessibilityPanel";
import { loadPrefs, savePrefs, applyToDOM, type AccessibilityPrefs } from "./statusConfig";
import type { Role as AdminRole, Tab as AdminTab } from "./AdminPanel";

// Le regole della lavanderia (turni, macchine, prenotazioni) e i testi stanno
// in file loro: qui restano i componenti. Vedi modello.ts, i18n.ts, tema.ts.
import {
  TIME_SLOTS, WEEKLY_QUOTA, APP_VERSION,
  TODAY_DOW, CUR_SLOT, PREV_SLOT, DAYS_DATE, monShort,
  slotEndDate,
  machinesFor, bookingAt, deriveMachines, nextRef,
  myWeekBookings, isPastBooking, isCurrentBooking,
  favsKey, loadFavs,
  type WeekData, type StatusData, type Machine, type MachineType,
  type MyBooking, type Fav,
} from "./modello";
import { T, errMsg, linguaIniziale, salvaLingua, type Lang } from "./i18n";
import { SettingsSheet, InstallPrompt } from "./pannelli";
import {
  RED, RED_FG, GREEN, YELLOW, OOS_C, ORANGE,
  GREEN_T, YELLOW_T, OOS_T, ORANGE_T, type Theme,
} from "./tema";

// Le schermate amministrative vivono dentro questa stessa app, aperte dal menu
// Impostazioni. In lazy perché la stragrande maggioranza di chi apre l'app non
// ha una sessione admin e non deve scaricarne il codice.
const AdminScreens   = lazy(() => import("./AdminPanel").then((m) => ({ default: m.AdminScreens })));
const AdminLoginSheet = lazy(() => import("./AdminPanel").then((m) => ({ default: m.AdminLoginSheet })));

// Le sezioni amministrative sono destinazioni di navigazione come le altre,
// non un pannello a parte: chi ha la sessione le trova nella stessa lista di
// Lavanderia, Cinema e Musica.
type Facility = "laundry" | "cinema" | "music" | "conferenze" | AdminTab;

const ADMIN_TABS: AdminTab[] = ["macchine", "segnalazioni", "account", "ricorrenti", "manutenzione"];
const isAdminFacility = (f: Facility): f is AdminTab => (ADMIN_TABS as string[]).includes(f);

/** Etichetta della camera nell'intestazione. Chi amministra è la Direzione. */
// "St. 318" era un'abbreviazione che non abbreviava niente: la pastiglia ha
// spazio, e nell'app la parola e' "camera" dappertutto. Da quando il saluto
// ("Buonasera, camera 318") non c'e' piu', questo e' l'UNICO posto dove sta
// scritta la camera — quindi ci sta scritta per intero.
const roomLabel = (room: string | null, t: { changeRoom: string; room: string }) =>
  room === api.DIREZIONE ? "DIREZIONE" : room ? `${t.room} ${room}` : t.changeRoom;

// Preferenze accessibilità a livello di modulo — lette da tutti i componenti,
// aggiornate da App.handleAccessibilityChange. Evita il prop-drilling profondo.
let accessibilityPrefs: AccessibilityPrefs = loadPrefs();

// ─── Icona lavatrice ───────────────────────────────────────────────────────────
function WashingMachine({ size = 16, style, className }: { size?: number; style?: React.CSSProperties; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={style} className={className} aria-hidden="true">
      <rect width="18" height="20" x="3" y="2" rx="2" />
      <path d="M3 6h18" />
      <path d="M7 4h.01" />
      <path d="M10.5 4h.01" />
      <circle cx="12" cy="14" r="5" />
      <path d="M12 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 1 0-5" />
    </svg>
  );
}



// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    // Largo al massimo quanto lo schermo meno i margini, e il testo va a capo:
    // con "whitespace-nowrap" un messaggio lungo (per esempio quello che spiega
    // che il turno e' della Direzione) usciva dai due lati del telefono.
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-toast-in pointer-events-none px-4 w-full max-w-[26rem]">
      <div className="flex items-start gap-2.5 rounded-2xl px-4 py-3 shadow-2xl pointer-events-auto border"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <CheckCircle2 size={14} className="shrink-0 mt-0.5" style={{ color: RED }}/>
        <span className="text-sm font-medium leading-snug min-w-0" style={{ color: "var(--foreground)", overflowWrap:"anywhere" }}>{msg}</span>
      </div>
    </div>
  );
}

/**
 * Invio conferma.
 *
 * Da telefono non serve a niente, da PC e' il gesto naturale: si arriva alla
 * schermata di conferma, si legge, si preme Invio. Non succedeva niente, e il
 * pulsante rosso li' davanti sembrava rotto.
 *
 * `attivo` esiste perche' vada SOLO dove c'e' una cosa sola da confermare:
 * dove i pulsanti sono due o piu' (scegli la lavatrice, modifica o elimina)
 * Invio dovrebbe indovinare quale, e indovinare non e' un'opzione.
 *
 * Non intercetta l'Invio dentro un campo di testo lungo, dove va a capo.
 */
function useInvio(attivo: boolean, azione: () => void) {
  useEffect(() => {
    if (!attivo) return;
    const onTasto = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat) return;
      const dove = e.target as HTMLElement | null;
      if (dove && (dove.tagName === "TEXTAREA" || dove.isContentEditable)) return;
      e.preventDefault();
      azione();
    };
    window.addEventListener("keydown", onTasto);
    return () => window.removeEventListener("keydown", onTasto);
  }, [attivo, azione]);
}

// ─── BookModal (nuova prenotazione / modifica) ────────────────────────────────

interface BookTarget { dayIdx?: number; slotIdx: number; machineId: string; prefillRoom?: string; }

function BookModal({ target, bookings, status = {}, myRoom, lang, isAdmin = false, onConfirm, onClose }: {
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

// ─── ModifyModal (modifica/elimina prenotazione esistente) ─────────────────────

interface ModifyTarget { dayIdx: number; slotIdx: number; machineId: string; currentRoom: string; }

function ModifyModal({ target, lang, onEdit, onDelete, onClose }: {
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
        <p className="text-sm mb-6" style={{ color:sub }}>
          {t.bookedBy(target.currentRoom).replace(target.currentRoom, "")}<span style={{ color:fg, fontWeight:600 }}>{target.currentRoom}</span>
        </p>
        <p className="text-xs mb-3" style={{ color:sub }}>{t.wantModify}</p>
        <div className="flex flex-col gap-2">
          <button onClick={onEdit} className="w-full py-3.5 rounded-2xl text-sm font-semibold" style={{ background:RED, color:RED_FG }}>
            {t.modify}
          </button>
          <button onClick={onDelete} className="w-full py-3.5 rounded-2xl text-sm font-semibold" style={{ background: "color-mix(in srgb, var(--destructive) 10%, transparent)", color: OOS_T }}>
            {t.delete}
          </button>
          <button onClick={onClose} className="w-full py-3 rounded-2xl text-sm" style={{ color:sub }}>
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Popup "Aggiungi preferito": scegli giorno + fascia oraria ──────────────────
function FavPicker({ lang, favs, onAdd, onRemove, onClose }: {
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

// ─── Modale scelta lavatrice (da un turno preferito) ────────────────────────────
function QuickBookModal({ lang, day, slot, week, status, roomNumber, onBook, onClose }: {
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

// ─── Modale Feedback ────────────────────────────────────────────────────────────
function FeedbackModal({ lang, room, onClose }: { lang: Lang; room: string | null; onClose: ()=>void }) {
  const t = T[lang];
  const fg="var(--foreground)", sub="var(--gray-accessible-text)", chip="var(--secondary)", div="var(--border)";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err,  setErr]  = useState(false);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(false);
    try { await api.sendFeedback(room, text.trim()); setDone(true); setTimeout(onClose, 1300); }
    catch { setErr(true); setBusy(false); }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pt-5 pb-7 px-6 max-h-[92%] overflow-y-auto overscroll-contain" style={{ background:"var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background:"color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-2xl" style={{ background:`color-mix(in srgb, var(--primary) 15%, transparent)`, color:RED }}><MessageSquare size={18}/></div>
          <p className="text-lg font-bold" style={{ color:fg }}>{t.feedback}</p>
        </div>
        {done ? (
          <p className="text-sm py-6 text-center font-medium" style={{ color:GREEN_T }}>{t.feedbackThanks}</p>
        ) : (
          <>
            <p className="text-sm mb-3" style={{ color:sub }}>{t.feedbackBody}</p>
            <textarea value={text} onChange={(e)=>setText(e.target.value)} rows={4} placeholder={t.feedbackPlaceholder}
              className="w-full rounded-2xl px-3 py-2.5 text-sm outline-none mb-2 resize-none"
              style={{ background:chip, color:fg, border:`1px solid ${div}` }}/>
            {err && <p className="text-xs mb-2" style={{ color:OOS_T }}>{t.feedbackError}</p>}
            <button onClick={send} disabled={!text.trim() || busy}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
              style={{ background:RED, color:RED_FG, opacity:(!text.trim() || busy) ? 0.5 : 1 }}>
              <Send size={15}/>{busy ? t.feedbackSending : t.feedbackSend}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────

// memo, qui e sulle altre due viste: ricevono prop stabili — `week` e `status`
// cambiano solo a un caricamento nuovo, i callback sono useCallback in App.
// Senza, bastava aprire Impostazioni o far comparire un pannello per
// ridisegnare da capo anche la griglia settimanale, che sono 7x19 celle: lavoro
// buttato, e su un telefono lento si sente.
const Dashboard = memo(function Dashboard({ lang, week, status, roomNumber, favs, onToggleFav, onBook, onClear, onGoWeek }: {
  theme: Theme; lang: Lang; week: WeekData; status: StatusData; roomNumber: string;
  favs: Fav[]; onToggleFav: (day:number, slot:number)=>void;
  onBook: (day:number, slot:number, machine:string, room:string)=>Promise<void>;
  onClear: (day:number, slot:number, machine:string)=>Promise<void>;
  // Porta alla griglia della settimana: e' li' che si sceglie un turno
  // qualunque, con davanti quali sono liberi e quali no.
  onGoWeek: ()=>void;
}) {
  const t = T[lang];
  const [now, setNow]           = useState(new Date());
  const [toast, setToast]       = useState<string | null>(null);
  const [favPicker, setFavPicker] = useState(false);
  const [quickTarget, setQuickTarget] = useState<{ day:number; slot:number } | null>(null);

  const fg   = "var(--foreground)";
  const sub  = "var(--gray-accessible-text)";
  const surf = "var(--card)";
  const div  = "var(--border)";

  const slot = TIME_SLOTS[CUR_SLOT];
  // Il turno dura 75 minuti: quanto ne resta, come frazione e in minuti.
  const restaMs  = Math.max(0, slotEndDate(CUR_SLOT).getTime() - now.getTime());
  const restaFr  = restaMs / (75 * 60_000);
  const restaMin = Math.ceil(restaMs / 60_000);
  // Nell'ultimo minuto si contano i secondi. Un "1 min" fermo per sessanta
  // secondi non dice piu' niente proprio quando la cosa comincia a contare:
  // e' li' che uno decide se fa in tempo a scendere.
  const ultimoMinuto = restaMs < 60_000;
  const restaTesto   = ultimoMinuto ? `${Math.ceil(restaMs / 1000)} s` : `${restaMin} min`;

  useEffect(() => {
    // Dieci secondi bastano per una cifra in minuti; nell'ultimo minuto serve
    // il secondo, e per quei sessanta secondi si puo' pagare un render al
    // secondo. Cambiare passo rimonta l'intervallo, ed e' l'unica volta in cui
    // succede: `ultimoMinuto` e' un booleano, non cambia a ogni battito.
    const id = setInterval(() => {
      const n = new Date();
      setNow(n);
      if (slotEndDate(CUR_SLOT).getTime() - n.getTime() <= 0) {
        window.location.reload();
      }
    }, ultimoMinuto ? 1000 : 10_000);
    return () => clearInterval(id);
  }, [ultimoMinuto]);

  const machines = deriveMachines(week, status, TODAY_DOW, CUR_SLOT, roomNumber);

  const myBookings     = myWeekBookings(week, roomNumber);
  // La quota è "per camera": la Direzione non è una camera e il server non
  // gliela applica (book_as_direzione non la controlla, di proposito). Senza
  // questa eccezione il conteggio lato client avrebbe detto "0 rimaste" alla
  // terza prenotazione della portineria, che invece sarebbe passata.
  const senzaQuota     = roomNumber === api.DIREZIONE;
  const remaining      = senzaQuota ? Infinity : WEEKLY_QUOTA - myBookings.length;
  const activeBookings = myBookings.filter((b) => !isPastBooking(b));

  // Prima lavatrice libera in un dato (giorno, slot)
  const firstFreeWasherAt = (day: number, s: number): string | null => {
    const washIds = machinesFor(roomNumber).washers;
    return washIds.find((wid) => status[wid] !== "oos" && !week[day]?.[s]?.[wid]) ?? null;
  };

  // Prenota una lavatrice scelta a mano (dal modale dei preferiti).
  // Rilancia l'errore così il modale resta aperto e lo mostra.
  async function quickBook(day: number, s: number, mid: string) {
    if (!roomNumber) return;
    await onBook(day, s, mid, roomNumber);
    setToast(t.booked(mid[2]));
  }

  // I turni preferiti ancora liberi, dal piu' vicino nel tempo.
  //
  // Stavano solo dentro il pannello della stella, cioe' dietro un tocco: se
  // uno ha segnato "la domenica alle 22" e la domenica e' libera, doveva
  // aprire il pannello per scoprirlo — e lo apriva solo se gli veniva in
  // mente. Un turno libero che ti interessa e' una notizia, e le notizie non
  // si mettono dentro un cassetto: compaiono sotto le proprie prenotazioni,
  // gia' pronte da prendere.
  //
  // Solo quelli LIBERI e ancora da venire: un preferito pieno, o gia'
  // passato, non e' una cosa da fare — quello resta nel pannello, dove si
  // guarda l'elenco per intero.
  const preferitiLiberi = favs
    .filter((f) => !isPastBooking({ day: f.day, slot: f.slot, mid: "W-A" }))
    .map((f) => ({ ...f, mid: firstFreeWasherAt(f.day, f.slot) }))
    .filter((f): f is Fav & { mid: string } => f.mid !== null)
    // Giorno e fascia crescono insieme al tempo, e il passato e' gia' fuori:
    // ordinare per (giorno, fascia) e' ordinare per "quanto manca".
    .sort((a, b) => a.day - b.day || a.slot - b.slot);

  async function cancelBooking(b: MyBooking) {
    try { await onClear(b.day, b.slot, b.mid); setToast(t.slotDeleted); }
    catch (e) { setToast(errMsg(e, lang)); }
  }

  // Mostriamo lavatrici e asciugatrici in due gruppi separati (A/B/C ciascuno):
  // la lavatrice è prenotabile; l'asciugatrice è in sola lettura (auto-riservata
  // dal backend col turno successivo) e mostra occupante attuale e precedente.
  const washers = machines.filter((m) => m.type === "washer");
  const dryers  = machines.filter((m) => m.type === "dryer");

  return (
    <div className="flex flex-col pb-6 md:pt-8 md:max-w-3xl md:mx-auto md:w-full">
      {toast     && <Toast msg={toast} onClose={()=>setToast(null)}/>}
      {/* Aggiungere non chiude piu' il pannello: da quando l'elenco sta li'
          dentro, quello e' il posto dove si sistemano i preferiti — se ne
          mette uno, lo si vede comparire nella lista, se ne mette un altro.
          Si esce con la X. */}
      {favPicker && (
        <FavPicker lang={lang} favs={favs} onClose={()=>setFavPicker(false)}
          onAdd={(d, s)=>{ if (!favs.some((f)=>f.day===d && f.slot===s)) onToggleFav(d, s); }}
          onRemove={onToggleFav}/>
      )}
      {quickTarget && (
        <QuickBookModal lang={lang} day={quickTarget.day} slot={quickTarget.slot}
          week={week} status={status} roomNumber={roomNumber} onBook={quickBook}
          onClose={()=>setQuickTarget(null)}/>
      )}

      {/* Il saluto non e' piu' una riga sua: e' integrato nella pastiglia
          "Camera 318" in cima allo schermo (vedi App, il chip mobile). Stava
          qui da solo sopra un vuoto che il telefono riempie gia' con la sua
          barra di stato — la stessa informazione, un centimetro piu' sotto. */}

      {/* Lavatrici */}
      <section className="px-5 mb-4">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <p className="text-[11px] font-mono tracking-widest uppercase" style={{ color:sub }}>{t.machines}</p>
          {/* Da che ora vale quel che si vede qui sotto, e quanto manca alla
              fine. Il solo "46 min" diceva la seconda meta' della frase: non
              si capiva se il turno fosse cominciato adesso o quasi finito, e
              soprattutto non si sapeva DI QUALE turno si stesse parlando. */}
          <span className="flex items-center gap-2 shrink-0"
            title={`${t.currentSlot} ${slot.start}–${slot.end} · ${t.slotEndsIn} ${restaTesto}`}>
            <span className="text-[11px] font-semibold tabular-nums" style={{ color:fg }}>{t.slotFrom(slot.start)}</span>
            <span className="flex items-center gap-1">
              <TortaTurno restaFrazione={restaFr} colore={RED}/>
              <span className="text-[11px] font-mono tabular-nums"
                    style={{ color: ultimoMinuto ? RED : sub, fontWeight: ultimoMinuto ? 700 : 400 }}>
                {restaTesto}
              </span>
            </span>
          </span>
        </div>

        {/* Macchine raggruppate per lettera: A (lavatrice + asciugatrice), B, C.
            Il nome è scritto per esteso su ogni riga — "Lavatrice A" — invece di
            avere la lettera in un'intestazione sopra e "Lavatrice" sotto. Erano
            due pezzi da ricomporre con l'occhio, e nei messaggi ("Lavatrice B
            segnalata non funzionante", "Lav. C · 22:00") la macchina si chiama
            già così. */}
        <div className="flex flex-col gap-3">
          {machinesFor(roomNumber).washers.map((id) => id[2]).map((L) => {
            const wm = washers.find((m) => m.label === L);
            const dm = dryers.find((m) => m.label === L);
            return (
              <div key={L} className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
                {wm && <MachineRow key={wm.id} machine={wm} lang={lang}
                  groupLabel={`${t.washerLabel} ${L}`}
                  isLast={false} divColor={div}/>}
                {dm && <MachineRow key={dm.id} machine={dm} lang={lang}
                  groupLabel={`${t.dryerLabel} ${L}`}
                  isLast divColor={div}/>}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] mt-2" style={{ color:sub }}>{t.machinesInfo}</p>
      </section>

      <div className="mx-5 mb-4 border-t" style={{ borderColor:div }}/>


      {/* Le tue prenotazioni */}
      {roomNumber && (
        <section className="px-5 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[11px] font-mono tracking-widest uppercase flex-1 min-w-0" style={{ color:sub }}>{t.yourBookings}</p>
            {/* Quanti turni restano, e basta: 2, 1, 0. In rosso con il segno
                meno quando si e' andati oltre — che e' l'unico caso in cui la
                pastiglia deve farsi guardare.

                Diceva "2 rimaste", e sotto l'elenco una riga ripeteva "Puoi
                ancora prenotare 2 turni questa settimana (max 2 a camera)".
                Tre modi di dire lo stesso numero nella stessa schermata. La
                frase intera resta nel title, per chi la vuole. */}
            <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full tabular-nums"
              title={senzaQuota ? t.noQuota : t.remainingMsg(remaining)}
              style={{
                background: senzaQuota || remaining > 0 ? `color-mix(in srgb, ${GREEN} 15%, transparent)`
                          : remaining === 0 ? "var(--secondary)"
                          : `color-mix(in srgb, var(--destructive) 15%, transparent)`,
                color: senzaQuota || remaining > 0 ? GREEN_T : remaining === 0 ? sub : OOS_T,
              }}>
              {senzaQuota ? "∞" : remaining}
            </span>
          </div>
          <div className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
            {activeBookings.length === 0 ? (
              /* "Nessuna prenotazione attiva" era un vicolo cieco: constatava
                 il vuoto e non diceva come uscirne. La riga sotto lo dice, e
                 porta dove i turni si vedono tutti insieme. */
              <div className="px-4 py-3">
                <p className="text-xs" style={{ color:sub }}>{t.noActiveBookings}</p>
              </div>
            ) : (
              activeBookings.map((b, i) => {
                const cur = isCurrentBooking(b);
                const s   = TIME_SLOTS[b.slot];
                return (
                  /* Il turno in corso era rosso pieno sull'icona, con la riga
                     tinta dietro e un pallino che pulsava: tre segnali d'allarme
                     per una cosa che non e' un allarme — e' solo il tuo bucato
                     che sta girando. Resta la parola "In corso ora" e un
                     pallino fermo; il colore accompagna, non grida. */
                  <div key={`${b.day}-${b.slot}-${b.mid}`} className="flex items-center gap-3 px-4 py-3"
                    style={{ borderBottom: i < activeBookings.length - 1 ? `1px solid ${div}` : "none",
                             background: cur ? `color-mix(in srgb, var(--primary) 4%, transparent)` : "transparent" }}>
                    {/* Il rosso resta una cosa sola: il turno che sta girando
                        adesso. Su ogni altra riga l'icona era rossa anche per
                        un turno di venerdi' prossimo, e a furia di essere
                        dappertutto non voleva piu' dire niente. */}
                    <div className="p-2 rounded-xl shrink-0"
                      style={ cur
                        ? { background:`color-mix(in srgb, var(--primary) 12%, transparent)`, color:RED }
                        : { background:"var(--secondary)", color:sub } }>
                      <WashingMachine size={15}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color:fg }}>{t.lavBreve} {b.mid[2]} · {s.start}–{s.end}</p>
                      <p className="text-[11px] font-mono" style={{ color: cur ? RED : sub }}>
                        {cur ? t.inProgressNow : `${t.days[b.day]} ${DAYS_DATE[b.day]} ${monShort(b.day, t.mesiBrevi)}`}
                      </p>
                    </div>
                    {/* Lampeggia: e' l'unica cosa in tutta la schermata che sta
                        succedendo proprio ora, e il movimento e' il modo di
                        dirlo. Si ferma da solo per chi ha chiesto meno
                        animazioni al sistema (vedi style.css). */}
                    {cur && <span className="size-2 rounded-full shrink-0 lampeggia" style={{ background:RED }}/>}
                    <button onClick={()=>cancelBooking(b)} aria-label={t.delete}
                      className="p-2 rounded-lg shrink-0 transition-all active:scale-90"
                      style={{ background:"var(--secondary)", color:sub }}>
                      <Trash2 size={14}/>
                    </button>
                  </div>
                );
              })
            )}

            {(senzaQuota || remaining > 0) && (
              // Rosso, qui, leggeva come un avviso — la stessa tinta del
              // cestino appena sopra. Grigio neutro come le altre azioni
              // dell'app (Segnala guasto, Feedback): e' un invito, non un
              // pericolo.
              <button onClick={onGoWeek}
                className="w-full flex items-center justify-center gap-2 py-3 border-t transition-colors"
                style={{ borderColor:div, background:"transparent", color:fg }}>
                <Plus size={14} style={{ color:sub }}/>
                <span className="text-sm font-bold">
                  {activeBookings.length === 0 ? t.bookSlot : t.bookAnother}
                </span>
              </button>
            )}
          </div>

          {/* Un'intestazione tutta loro, con il pulsante in alto a destra come
              nelle altre sezioni. Serve a due cose: dice che quelle righe
              tratteggiate sono PREFERITI e non prenotazioni, e mette "aggiungi"
              dove uno lo cerca — accanto al titolo, non in fondo all'elenco. */}
          <div className="flex items-center justify-between gap-2 mt-4 mb-2">
            <p className="text-[11px] font-mono tracking-widest uppercase" style={{ color:sub }}>{t.favorites}</p>
            <button onClick={()=>setFavPicker(true)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-all active:scale-95 shrink-0"
              style={{ background:`color-mix(in srgb, var(--primary) 12%, transparent)`, color:RED }}>
              <Plus size={12}/>{t.addFav}
            </button>
          </div>

          {/* FUORI dalla scheda, e con il bordo tratteggiato.
          
              Stavano dentro l'elenco qui sopra, righe verdi fra le righe delle
              prenotazioni vere: sembravano turni gia' presi. Sono l'opposto —
              turni che NON hai e che potresti prendere. Il tratteggio dice
              "non e' ancora tuo" prima di qualunque parola, e la parola
              comunque c'e'. */}
          {preferitiLiberi.map((f) => {
            const sl = TIME_SLOTS[f.slot];
            return (
              <div key={`fav-${f.day}-${f.slot}`}
                className="flex items-center gap-3 px-4 py-2.5 mt-2 rounded-2xl"
                style={{
                  border:`1px dashed color-mix(in srgb, ${GREEN} 50%, transparent)`,
                  background:`color-mix(in srgb, ${GREEN} 4%, transparent)`,
                }}>
                <Star size={15} className="shrink-0" style={{ color:ORANGE, fill:ORANGE }}/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color:fg }}>
                    {t.days[f.day]} {DAYS_DATE[f.day]} · {sl.start}–{sl.end}
                  </p>
                  <p className="text-[11px]" style={{ color:sub }}>{t.favAvailable}</p>
                </div>
                <button onClick={()=>setQuickTarget({ day:f.day, slot:f.slot })}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-all active:scale-95 shrink-0"
                  style={{ background:`color-mix(in srgb, ${GREEN} 16%, transparent)`, color:GREEN_T }}>
                  <Plus size={12}/>{t.book}
                </button>
              </div>
            );
          })}

        </section>
      )}

      {/* Turni liberi oggi 
      <section className="px-5 mb-4">
        <div className="rounded-2xl border flex items-center gap-3 px-4 py-3.5" style={{ background:surf, borderColor:div }}>
          <div className="p-2 rounded-xl shrink-0" style={{ background:`color-mix(in srgb, ${GREEN} 15%, transparent)`, color:GREEN_T }}>
            <LayoutGrid size={16}/>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums" style={{ color:fg }}>{freeTodaySlots}</span>
            <span className="text-xs" style={{ color:sub }}>{t.freeTodayLabel}</span>
          </div>
        </div>
      </section>
      */}

    </div>
  );
});

function TortaTurno({ restaFrazione, colore, size = 15 }: {
  restaFrazione: number; colore: string; size?: number;
}) {
  const r = 7;
  const a = 2 * Math.PI * Math.max(0, Math.min(1, restaFrazione));
  // A spicchio pieno l'arco degenera (punto di partenza e di arrivo
  // coincidono) e non disegnerebbe niente: li' serve il cerchio intero.
  const pieno = restaFrazione >= 0.999;
  const x = 9 + r * Math.sin(a);
  const y = 9 - r * Math.cos(a);

  return (
    <svg width={size} height={size} viewBox="0 0 18 18" className="shrink-0" aria-hidden="true">
      <circle cx="9" cy="9" r={r} fill="none" stroke={colore} strokeWidth="1.5" opacity={0.3}/>
      {pieno
        ? <circle cx="9" cy="9" r={r} fill={colore}/>
        : a > 0.001 && <path d={`M9 9 L9 ${9 - r} A${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x} ${y} Z`} fill={colore}/>}
    </svg>
  );
}

function MachineRow({ machine, lang, isLast, divColor, groupLabel }: {
  machine: Machine; lang: Lang; isLast: boolean; divColor: string; groupLabel?: string;
}) {
  const t = T[lang];
  const fg  = "var(--foreground)";

  const isFree  = machine.status === "available";
  const isOOO   = machine.status === "out-of-order";

  // Il pallino dice lo stato con lo stesso colore della legenda qui sotto
  // (verde libera, giallo in uso, rosso fuori servizio). Era stato tolto
  // perche' l'etichetta lo ripete a parole, ma cosi' la riga "in uso" non
  // aveva piu' niente in comune con la voce corrispondente della legenda.
  const dotColor   = isOOO ? OOS_C : isFree ? GREEN   : YELLOW;
  const glifoColor = isOOO ? OOS_T : isFree ? GREEN_T : YELLOW_T;
  // 6% dipingeva mezzo elenco di verde — con sei macchine quasi tutte libere
  // era lo sfondo normale, non un'eccezione. Il verde resta dove significa
  // qualcosa: sulla parola "Libera".
  const rowBg = isFree ? `color-mix(in srgb, ${GREEN} 3%, transparent)` : "transparent";

  // Fuori servizio e occupata sono due fatti indipendenti, e prima il primo
  // nascondeva il secondo: una macchina guasta ma gia' prenotata risultava
  // solo "Fuori servizio", senza pulsante, e sembrava libera con un comando
  // mancante. Ora si dicono entrambi.
  const statusText = isOOO
    ? (machine.room ? `${t.oos} · ${t.room} ${machine.room}` : t.oos)
    : isFree ? t.free : `${t.room} ${machine.room}`;
  // Finisce su testo (l'etichetta di stato della riga), quindi variante scura.
  const statusColor = isFree ? GREEN_T : isOOO ? OOS_T : fg;

  return (
    <div style={{ borderBottom:isLast?"none":`1px solid ${divColor}`, background:rowBg }}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Pallino di stato + icona macchina. Chi ha scelto le forme al posto
            dei colori nelle impostazioni di accessibilità vede il simbolo al
            posto del pallino. */}
        <div className="flex items-center gap-2.5 shrink-0" style={{ color:fg }}>
          {(() => {
            const sk = isOOO ? "oos" : isFree ? "free" : "inuse";
            const ci = accessibilityPrefs.icons[sk as "free"|"inuse"|"oos"];
            // Il simbolo e' testo (a 11px, per giunta), il pallino e' una
            // superficie: due livelli di colore diversi. Vedi la legenda.
            return ci !== "●"
              ? <span className="shrink-0 text-[11px] leading-none" style={{ color:glifoColor }}>{ci}</span>
              : <span className="size-2 rounded-full shrink-0" style={{ background:dotColor }}/>;
          })()}
          {machine.type==="washer" ? <WashingMachine size={18}/> : <Wind size={17}/>}
        </div>

        {/* Etichetta + stato, impilati (così non si accavallano su mobile) */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight truncate" style={{ color:fg }}>
            {groupLabel ?? `${machine.type === "washer" ? t.washerLabel : t.dryerLabel} ${machine.label}`}
          </p>
          <p className="text-xs font-medium leading-tight truncate" style={{ color:statusColor }}>{statusText}</p>
        </div>

        {/* Azioni */}
        <div className="flex items-center gap-2 shrink-0">
          {machine.prevRoom && (
            <span className="flex items-center gap-1 rounded-xl px-2 py-1.5"
              style={{ background:`color-mix(in srgb, ${ORANGE} 12%, transparent)`, color:ORANGE_T }}
              title={`${t.lgPrev}: ${machine.prevRoom}`}>
              <History size={13} className="shrink-0"/>
              <span className="text-[11px] font-mono font-semibold">{machine.prevRoom}</span>
            </span>
          )}
          {/* Il triangolo resta: e' l'unico segnale che il guasto e' stato
              verificato dall'amministrazione, e vale per tutte le macchine
              ora che non c'e' piu' un pulsante a distinguerle. */}
          {isOOO && <AlertTriangle size={15} style={{ color:OOS_T }}/>}
        </div>
      </div>
    </div>
  );
}


// ─── Day Schedule ──────────────────────────────────────────────────────────────

const DaySchedule = memo(function DaySchedule({ lang, week, status, roomNumber: sessionRoom, favs, onToggleFav, onBook, onClear, isAdmin }: {
  theme: Theme; lang: Lang; week: WeekData; status: StatusData; roomNumber: string;
  favs: Fav[]; onToggleFav: (day:number, slot:number)=>void;
  onBook: (day:number, slot:number, machine:string, room:string)=>Promise<void>;
  onClear: (day:number, slot:number, machine:string)=>Promise<void>;
  isAdmin: boolean;
}) {
  const t = T[lang];
  const [selDay, setSelDay]       = useState(TODAY_DOW);
  const [target, setTarget]       = useState<BookTarget | null>(null);
  const [modTarget, setModTarget] = useState<ModifyTarget | null>(null);
  const [toast, setToast]         = useState<string | null>(null);

  const fg  = "var(--foreground)";
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
      setToast(`${t.slotConfirmed} · ${TIME_SLOTS[ti.slotIdx].start}`);
    } catch (e) { setToast(errMsg(e, lang)); }
  }

  async function deleteBooking() {
    if (!modTarget) return;
    const mt = modTarget;
    setModTarget(null);
    try { await onClear(mt.dayIdx, mt.slotIdx, mt.machineId); setToast(t.slotDeleted); }
    catch (e) { setToast(errMsg(e, lang)); }
  }

  // Piu' largo di prima (era 3xl, 768px) ma non a tutta pagina: qui le colonne
  // sono solo le lavatrici, e oltre un certo punto diventano bande vuote.
  return (
    <div className="flex flex-col h-full lg:max-w-5xl lg:mx-auto lg:w-full">
      {toast     && <Toast msg={toast} onClose={()=>setToast(null)}/>}
      {target    && <BookModal target={{...target,dayIdx:selDay}} bookings={week} status={status} isDark={false} lang={lang} myRoom={sessionRoom} isAdmin={isAdmin} onConfirm={confirmBooking} onClose={()=>setTarget(null)}/>}
      {modTarget && (
        <ModifyModal
          target={modTarget} isDark={false} lang={lang}
          onEdit={()=>{ setTarget({ slotIdx:modTarget.slotIdx, machineId:modTarget.machineId, dayIdx:modTarget.dayIdx, prefillRoom:modTarget.currentRoom }); setModTarget(null); }}
          onDelete={deleteBooking}
          onClose={()=>setModTarget(null)}
        />
      )}

      <div className="px-5 pt-3 pb-2 shrink-0">
        <h2 className="text-base font-bold mb-2" style={{ color:fg }}>{t.daily}</h2>
        <div className="grid grid-cols-7 gap-1">
          {t.days.map((d, i) => {
            const isActive = i===selDay;
            const isPast   = i<TODAY_DOW;
            return (
              <button key={d} onClick={()=>setSelDay(i)}
                className="flex flex-col items-center py-1.5 rounded-xl transition-colors"
                style={{ background:isActive?RED:"transparent", color:isActive?RED_FG:isPast?"color-mix(in srgb, var(--muted-foreground) 40%, transparent)":sub }}>
                <span className="text-[9px] font-mono uppercase leading-none mb-0.5">{d}</span>
                <span className="text-sm font-bold leading-none">{DAYS_DATE[i]}</span>
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
          const isPast = selDay<TODAY_DOW || (selDay===TODAY_DOW && si<CUR_SLOT);
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
                return (
                  <div key={mid} className="flex-1 px-1 py-1.5">
                    {room ? (
                      <button
                        onClick={()=>!isPast && setModTarget({ dayIdx:selDay, slotIdx:si, machineId:mid, currentRoom:room })}
                        className="w-full h-9 rounded-xl flex items-center justify-center transition-all active:scale-95"
                        style={{
                          background: isMe ? RED : "var(--secondary)",
                          border: `1px solid ${isMe ? RED : "var(--border)"}`,
                          boxShadow: isMe ? "0 2px 8px color-mix(in srgb, var(--primary) 35%, transparent)" : "none",
                          cursor:isPast?"default":"pointer"
                        }}>
                        <span className="text-[10px] font-mono font-bold" style={{ color:isMe?RED_FG:sub }}>{room}</span>
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

// ─── Slot detail sheet (vista settimanale) ────────────────────────────────────

interface SlotDetailTarget { dayIdx: number; slotIdx: number; }

function SlotDetailSheet({ target, bookings, lang, roomNumber, onBook, onModify, onDelete, onClose }: {
  target: SlotDetailTarget;
  bookings: WeekData;
  isDark: boolean;
  lang: Lang;
  roomNumber: string | null;
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
                    <p className="text-xs font-mono" style={{ color:room?sub:GREEN_T }}>
                      {room ? `${t.room} ${room}` : t.free}
                    </p>
                  </div>
                  {!room && (
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

// ─── Week Overview ─────────────────────────────────────────────────────────────

const WeekOverview = memo(function WeekOverview({ lang, week, status, roomNumber: sessionRoom, onBook, onClear, isAdmin }: {
  theme: Theme; lang: Lang; week: WeekData; status: StatusData; roomNumber: string;
  onBook: (day:number, slot:number, machine:string, room:string)=>Promise<void>;
  onClear: (day:number, slot:number, machine:string)=>Promise<void>;
  isAdmin: boolean;
}) {
  const t = T[lang];
  const [target, setTarget]           = useState<BookTarget | null>(null);
  const [modTarget, setModTarget]     = useState<ModifyTarget | null>(null);
  const [slotDetail, setSlotDetail]   = useState<SlotDetailTarget | null>(null);
  const [toast, setToast]             = useState<string | null>(null);
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
      setToast(`${t.slotConfirmed} · ${TIME_SLOTS[ti.slotIdx].start}`);
    } catch (e) { setToast(errMsg(e, lang)); }
  }

  async function deleteBooking() {
    if (!modTarget) return;
    const mt = modTarget;
    setModTarget(null);
    try { await onClear(mt.dayIdx, mt.slotIdx, mt.machineId); setToast(t.slotDeleted); }
    catch (e) { setToast(errMsg(e, lang)); }
  }

  async function deleteFromDetail(dayIdx: number, slotIdx: number, mid: string) {
    setSlotDetail(null);
    try { await onClear(dayIdx, slotIdx, mid); setToast(t.slotDeleted); }
    catch (e) { setToast(errMsg(e, lang)); }
  }

  // Nessun tetto di larghezza: la griglia ha sette colonne e piu' spazio ha,
  // piu' e' leggibile. Limitandola qui, il contenitore esterno resterebbe
  // vuoto ai lati — che era esattamente il problema.
  return (
    <div className="flex flex-col h-full w-full">
      {toast      && <Toast msg={toast} onClose={()=>setToast(null)}/>}
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
          onBook={(mid)=>{ setTarget({ dayIdx:slotDetail.dayIdx, slotIdx:slotDetail.slotIdx, machineId:mid }); setSlotDetail(null); }}
          onModify={(mid, room)=>{ setModTarget({ dayIdx:slotDetail.dayIdx, slotIdx:slotDetail.slotIdx, machineId:mid, currentRoom:room }); setSlotDetail(null); }}
          onDelete={(mid)=>{ deleteFromDetail(slotDetail.dayIdx, slotDetail.slotIdx, mid); }}
          onClose={()=>setSlotDetail(null)}
        />
      )}

      {stampaAperta && (
        <FoglioSettimana lang={lang} week={week} onClose={() => setStampaAperta(false)} />
      )}

      <div className="px-5 pt-3 pb-2 shrink-0 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold" style={{ color:fg }}>{t.overview}</h2>
        {/* Il foglio da appendere, per chi amministra — come quello della sala
            polivalente, e per lo stesso motivo: se l'app non risponde, in
            portineria la settimana deve esistere anche su carta. Non e' aperto
            a tutti perche' e' quello il caso d'uso; i dati sono gli stessi che
            la griglia qui sotto mostra gia' a chiunque. */}
        {isAdmin && (
          <button onClick={() => setStampaAperta(true)} aria-label="Stampa o esporta la settimana"
            className="p-2 rounded-xl shrink-0" style={{ background:"var(--secondary)", color:sub }}>
            <Printer size={16}/>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <div style={{ width: "100%" }}>

          <div className="flex" style={{ position:"sticky", top:0, zIndex:3, background:hdr, borderBottom:`1px solid ${div}` }}>
            <div style={{ width:TIME_W, flexShrink:0, position:"sticky", left:0, zIndex:4, background:hdr }}
              className="flex items-end justify-center pb-2">
              <span className={`${fsDay} font-mono uppercase`} style={{ color:sub }}>{t.now}</span>
            </div>
            {t.days.map((d, i) => {
              const isToday = i===TODAY_DOW;
              const isPast  = i<TODAY_DOW;
              return (
                <div key={d} className="flex flex-col items-center py-2 gap-0.5" style={dayCol}>
                  <span className={`${fsDay} font-mono uppercase`} style={{ color:isToday?RED:isPast?`color-mix(in srgb, var(--muted-foreground) 40%, transparent)`:sub }}>{d}</span>
                  <div className={`${isDesktop ? "w-8 h-8" : "w-7 h-7"} rounded-full flex items-center justify-center`} style={{ background:isToday?RED:"transparent" }}>
                    <span className="text-sm font-bold" style={{ color:isToday?RED_FG:isPast?`color-mix(in srgb, var(--muted-foreground) 40%, transparent)`:sub }}>{DAYS_DATE[i]}</span>
                  </div>
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

              {t.days.map((_, dayIdx) => {
                const dayData  = week[dayIdx] ?? {};
                const slotData = dayData[si] ?? {};
                const rooms    = Object.entries(slotData);
                const isToday  = dayIdx===TODAY_DOW;
                const isPastDay= dayIdx<TODAY_DOW;
                const isCur    = isToday && si===CUR_SLOT;
                const isPrevSl = isToday && si===PREV_SLOT;
                const isPast   = isPastDay || (isToday && si<CUR_SLOT);

                return (
                  <button key={dayIdx}
                    onClick={()=>{ if(!isPast) setSlotDetail({ dayIdx, slotIdx:si }); }}
                    className={`relative flex flex-col justify-start pt-1 gap-0.5 text-left transition-colors border-l ${isDesktop ? "px-1.5 hover:brightness-95" : "px-1"}`}
                    style={{ ...dayCol, minHeight:ROW_H, background:isCur?`color-mix(in srgb, var(--primary) 8%, transparent)`:isPrevSl?`color-mix(in srgb, var(--chart-4) 5%, transparent)`:"transparent", borderColor:div, opacity:isPast?0.38:1, cursor:isPast?"default":"pointer" }}>
                    {isCur    && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background:RED }}/>}
                    {isPrevSl && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background:ORANGE }}/>}
                    {rooms.map(([mid, room]) => {
                      const isMe = !!sessionRoom && room === sessionRoom;
                      return (
                        <div key={mid} className={`rounded-md flex items-center gap-1 w-full border ${isDesktop ? "px-1.5 py-1" : "px-1 py-0.5"}`}
                          style={{
                            background: isMe ? RED : "var(--secondary)",
                            borderColor: isMe ? RED : "var(--border)",
                          }}>
                          <span className={`${fsChip} font-mono font-bold shrink-0`} style={{ color:isMe?RED_FG:sub }}>{mid[2]}</span>
                          <span className={`${fsChip} font-mono truncate`} style={{ color:isMe?RED_FG:fg }}>{room}</span>
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

// ─── Foglio settimanale da stampare o esportare ────────────────────────────────
//
// Il gemello del foglio della sala polivalente (Conferenze.tsx), per la
// lavanderia. Il caso per cui esiste e' quello in cui l'app NON c'e': database
// in pausa, rete del residence giu', deploy andato storto. La settimana appesa
// in portineria vale come riferimento anche allora, e i turni si rispettano
// lo stesso invece di sciogliersi in "chi arriva prima".
//
// Il formato e' la griglia e non l'elenco, al contrario del foglio della sala:
// li' si legge "cosa succede questo mese", qui si cerca "chi ha le 14:00 di
// giovedi'" — un incrocio riga-colonna. Un elenco per giorno costringerebbe a
// scorrere tutto per rispondere a una domanda puntuale.
//
// L'id `foglio-stampa` e' lo stesso dell'altro foglio, e non e' un conflitto:
// i due vivono in sezioni diverse dell'app e non sono mai montati insieme, e
// le regole di @media print che servono a entrambi sono le stesse.

function FoglioSettimana({ lang, week, onClose }: {
  lang: Lang; week: WeekData; onClose: () => void;
}) {
  const t = T[lang];
  const fg = "var(--foreground)", sub = "var(--gray-accessible-text)";
  const div = "var(--border)", chip = "var(--secondary)";

  // Le macchine prenotate in una cella, in ordine di sigla: A prima di B.
  // Sono solo lavatrici — l'asciugatrice non e' una prenotazione ma il turno
  // successivo della stessa macchina, che il modello ricava (deriveMachines).
  const celle = (dayIdx: number, slotIdx: number) =>
    Object.entries(week[dayIdx]?.[slotIdx] ?? {}).sort(([a], [b]) => a.localeCompare(b));

  // La stessa cosa in righe, per il CSV e per sapere se c'e' qualcosa da
  // stampare.
  const righe: { day: number; slot: number; mid: string; room: string }[] = [];
  for (let day = 0; day < 7; day++) {
    for (let slot = 0; slot < TIME_SLOTS.length; slot++) {
      for (const [mid, room] of celle(day, slot)) righe.push({ day, slot, mid, room: String(room) });
    }
  }

  const d = new Date();
  const oggi = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function scaricaCsv() {
    // Punto e virgola e BOM per lo stesso motivo del foglio della sala: Excel
    // in locale italiano apre i file con la virgola in una colonna sola, e
    // senza BOM legge le accentate come ANSI.
    const esc = (v: string) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const testo = [
      ["Giorno", "Data", "Inizio", "Fine", "Macchina", "Camera"].join(";"),
      ...righe.map((r) => [
        t.days[r.day],
        `${DAYS_DATE[r.day]} ${monShort(r.day, t.mesiBrevi)}`,
        TIME_SLOTS[r.slot].start,
        TIME_SLOTS[r.slot].end,
        r.mid[2],
        r.room,
      ].map(esc).join(";")),
    ].join("\r\n");
    const blob = new Blob(["\ufeff" + testo], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lavanderia-settimana-${oggi}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end schermo-solo" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="foglio-modale w-full rounded-t-3xl px-6" style={{ background:"var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="foglio-modale__testa pt-6">
          <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background:"color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
          <div className="flex items-center justify-between mb-4">
            <p className="text-base font-bold" style={{ color:fg }}>Turni della settimana</p>
            <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color:sub, background:chip }}><X size={16}/></button>
          </div>
        </div>

        <div className="foglio-modale__corpo pb-4">
          <p className="text-xs mb-3" style={{ color:sub }}>
            {righe.length === 0
              ? "Nessuna prenotazione questa settimana: il foglio uscirebbe vuoto."
              : `${righe.length} turn${righe.length === 1 ? "o" : "i"} prenotat${righe.length === 1 ? "o" : "i"}.`}
          </p>

          {/* Su un telefono otto colonne non ci stanno: l'anteprima scorre in
              orizzontale. Il contenitore che scorre sta FUORI da #foglio-stampa,
              cosi' sulla carta non lascia tracce — li' la tabella e' larga
              quanto la pagina. */}
          <div className="anteprima-scorri">
            <div id="foglio-stampa">
              <div className="solo-in-stampa">
                <h1>Turni lavanderia</h1>
                <p className="sottotitolo">
                  Settimana dal {DAYS_DATE[0]} {monShort(0, t.mesiBrevi)} al {DAYS_DATE[6]} {monShort(6, t.mesiBrevi)}
                  {" · "}stampato il {d.toLocaleDateString()}
                </p>
              </div>

              <table className="tabella-settimana">
                <thead>
                  <tr>
                    <th className="col-ora">Ora</th>
                    {t.days.map((giorno, i) => (
                      <th key={giorno}>{giorno} {DAYS_DATE[i]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TIME_SLOTS.map((slot, si) => (
                    <tr key={slot.start}>
                      <td className="col-ora">{slot.start}</td>
                      {t.days.map((_, dayIdx) => (
                        <td key={dayIdx}>
                          {celle(dayIdx, si).map(([mid, room]) => (
                            <span key={mid} className="turno">{mid[2]} {String(room)}</span>
                          ))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="foglio-modale__piede pb-7 pt-3 flex gap-2">
          <button onClick={scaricaCsv} disabled={righe.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold border"
            style={{ borderColor:div, color:sub, background:"transparent", opacity: righe.length ? 1 : 0.5 }}>
            <Download size={15}/> CSV
          </button>
          <button onClick={() => window.print()} disabled={righe.length === 0}
            className="flex-[2] flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold"
            style={{ background:RED, color:RED_FG, opacity: righe.length ? 1 : 0.5 }}>
            <Printer size={15}/> Stampa
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Admin sheet (bottom sheet dalla dashboard) ───────────────────────────────

function SegnalaGuastoSheet({ lang, status, onStatus, onClose, roomNumber }: {
  theme?: Theme; lang: Lang; status: StatusData; roomNumber: string | null;
  onStatus: (machine:string, oos:boolean, nota?:string)=>Promise<void>; onClose: () => void;
}) {
  const t = T[lang];
  const [toast, setToast] = useState<string | null>(null);
  // La macchina per cui si sta scrivendo la nota, se si sta scrivendo.
  const [nota, setNota] = useState<{ m: Machine; testo: string } | null>(null);
  const bg   = "var(--background)";
  const fg   = "var(--foreground)";
  const sub  = "var(--gray-accessible-text)";
  const surf = "var(--card)";
  const div  = "var(--border)";

  const mk = (id: string, type: MachineType): Machine => ({
    id, label: id[2], type, status: status[id] === "oos" ? "out-of-order" : "available",
  });
  
  const avail = machinesFor(roomNumber);
  const washers: Machine[] = avail.washers.map((id)=>mk(id,"washer"));
  const dryers:  Machine[] = avail.dryers.map((id)=>mk(id,"dryer"));

  /**
   * Invia la segnalazione, con la nota se c'è.
   *
   * La nota è facoltativa ma serve: senza, all'amministratore arrivava solo
   * "Lavatrice B segnalata non funzionante", che non dice se perde acqua, non
   * centrifuga o non parte proprio — e la differenza cambia chi si chiama.
   * Il canale la trasportava già (`reportBroken` accetta una nota da sempre),
   * ma nessuna schermata la chiedeva: nel pannello si leggeva "senza altri
   * dettagli" senza che fosse mai stato possibile darne.
   */
  async function invia(m: Machine, testo?: string) {
    setNota(null);
    try { await onStatus(m.id, true, testo?.trim() || undefined); setToast(t.reportSent(m.label)); }
    catch (e) { setToast(errMsg(e, lang)); }
  }

  /**
   * Il secondo passo: scelta la macchina, si apre una schermata SUA.
   *
   * Prima la nota compariva come una scheda in fondo all'elenco delle
   * macchine: bisognava accorgersene e scorrere fin laggiù, con la lista
   * ancora davanti agli occhi a suggerire che ci fosse dell'altro da scegliere.
   * Qui la lista sparisce e resta una cosa sola da fare — scrivere, se si
   * vuole, e inviare — con l'indietro per cambiare macchina.
   */
  if (nota) {
    const etichetta = `${nota.m.type === "washer" ? t.washerLabel : t.dryerLabel} ${nota.m.label}`;
    return (
      <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
        {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
        <div className="w-full rounded-t-3xl pb-8 max-h-[92%] overflow-y-auto overscroll-contain" style={{ background:bg }} onClick={(e)=>e.stopPropagation()}>
          <div className="px-6 pt-5 pb-4">
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl shrink-0"
                  style={{ background:`color-mix(in srgb, var(--destructive) 12%, transparent)`, color:OOS_T }}>
                  {nota.m.type === "washer" ? <WashingMachine size={18}/> : <Wind size={17}/>}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-mono tracking-widest uppercase" style={{ color:sub }}>{t.reportOos}</p>
                  <p className="text-lg font-bold truncate" style={{ color:fg }}>{etichetta}</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-xl shrink-0" style={{ color:sub, background:"var(--secondary)" }}>
                <X size={16}/>
              </button>
            </div>
          </div>

          <div className="px-5">
            <p className="text-sm mb-2" style={{ color:fg }}>{t.notaDesc}</p>
            <textarea
              value={nota.testo} autoFocus rows={3} maxLength={200}
              onChange={(e)=>setNota((n)=>n && { ...n, testo:e.target.value })}
              placeholder={t.notaPlaceholder}
              className="w-full rounded-2xl px-4 py-3 text-sm outline-none resize-none mb-2"
              style={{ background:surf, color:fg, border:`1px solid ${div}` }}/>
            <p className="text-[11px] mb-4" style={{ color:sub }}>{t.notaFacoltativa}</p>

            <button onClick={()=>invia(nota.m, nota.testo)}
              className="w-full py-3.5 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 mb-2"
              style={{ background:RED, color:RED_FG }}>
              <Send size={15}/>{t.inviaSegnalazione}
            </button>
            <button onClick={()=>setNota(null)}
              className="w-full py-3 rounded-2xl text-sm font-medium"
              style={{ background:"transparent", color:sub }}>{t.back}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
      <div className="w-full rounded-t-3xl pb-8 overflow-y-auto" style={{ background:bg, maxHeight:"80%" }} onClick={(e)=>e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4">
          <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-mono tracking-widest uppercase mb-0.5" style={{ color:sub }}>{t.machineMgmt}</p>
              <p className="text-lg font-bold" style={{ color:fg }}>{t.oos}</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl" style={{ color:sub, background:"var(--secondary)" }}>
              <X size={16}/>
            </button>
          </div>
          <p className="text-xs mt-1" style={{ color:sub }}>{t.oosDesc}</p>
        </div>

        <div className="px-5 mb-4">
          <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.washers}</p>
          <div className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
            {washers.map((m, i) => (
              <SegnalaGuastoRow key={m.id} machine={m} lang={lang} isLast={i===washers.length-1} divColor={div} onToggle={()=>setNota({ m, testo:"" })} />
            ))}
          </div>
        </div>

        <div className="px-5">
          <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color:sub }}>{t.dryers}</p>
          <div className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
            {dryers.map((m, i) => (
              <SegnalaGuastoRow key={m.id} machine={m} lang={lang} isLast={i===dryers.length-1} divColor={div} onToggle={()=>setNota({ m, testo:"" })} />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

function SegnalaGuastoRow({ machine, lang, isLast, divColor, onToggle }: {
  machine: Machine; lang: Lang; isLast: boolean; divColor: string; onToggle: () => void;
}) {
  const t   = T[lang];
  const fg  = "var(--foreground)";
  const isOOO = machine.status === "out-of-order";

  return (
    <div className="flex items-center gap-4 px-4 py-3.5"
      style={{ borderBottom:isLast?"none":`1px solid ${divColor}`, background:isOOO?`color-mix(in srgb, var(--destructive) 10%, transparent)`:"transparent" }}>
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <span className="size-2 rounded-full shrink-0" style={{ background:isOOO?OOS_C:GREEN }}/>
        <div className="flex items-center gap-2" style={{ color:fg }}>
          {machine.type==="washer" ? <WashingMachine size={16}/> : <Wind size={16}/>}
          <span className="text-base font-mono font-bold">{machine.label}</span>
        </div>
        <span className="text-xs font-medium ml-1" style={{ color:isOOO?OOS_T:GREEN_T }}>
          {isOOO ? t.oos : t.operative}
        </span>
      </div>
      {/* Il residente segnala, non decide: mettere e togliere il fuori servizio
          e' passato agli amministratori. Se e' gia' segnalata non c'e' niente
          da fare, quindi il pulsante e' disattivato invece che nascosto —
          cosi' si capisce che la segnalazione e' gia' arrivata. */}
      <button onClick={onToggle} disabled={isOOO}
        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold shrink-0 transition-all active:scale-95 disabled:active:scale-100"
        style={isOOO
          ? { background:"var(--secondary)", color:"var(--gray-accessible-text)", cursor:"default" }
          : { background:`color-mix(in srgb, var(--destructive) 12%, transparent)`, color:OOS_T }}>
        {isOOO ? <><AlertTriangle size={12}/>{t.alreadyOos}</> : <><Wrench size={12}/>{t.reportAction}</>}
      </button>
    </div>
  );
}

// ─── Tastiera fisica per i tastierini ─────────────────────────────────────────

// I tasti accettati, gli stessi disegnati a schermo. Costante di modulo e non
// letterale dentro il componente: una regex scritta nel corpo e' un oggetto
// NUOVO a ogni render, quindi finirebbe per staccare e riattaccare
// l'ascoltatore in continuazione — ed e' cosi' che una tastiera "a volte non
// risponde".
const TASTI_CAMERA = /^[0-9abAB-]$/;

/**
 * Rende un tastierino su schermo digitabile anche da tastiera vera.
 *
 * Sta in un hook perché i tastierini sono due — quello della schermata camera e
 * quello dentro il modale di prenotazione — e prima solo il primo rispondeva
 * alla tastiera. Chi da computer arrivava a "per qualcun altro" si ritrovava a
 * dover tornare al mouse a metà operazione, senza capire perché lì non
 * funzionasse più.
 *
 * L'ascoltatore sta sulla finestra perché in nessuno dei due c'è un campo da
 * mettere a fuoco: le cifre le raccolgono i pulsanti disegnati. `attivo` lo
 * monta e lo smonta insieme al tastierino, così quando il modale è chiuso —
 * o quando sopra c'è il foglio di accesso amministratore — i tasti non li
 * intercetta nessuno.
 *
 * @param max  quante cifre accetta (6 per la camera, 4 nel modale)
 */
function useTastieraFisica(
  attivo: boolean,
  set: React.Dispatch<React.SetStateAction<string>>,
  onInvio: () => void,
  max: number,
  ammessi: RegExp,
) {
  // In un ref, non fra le dipendenze: `onInvio` è una funzione nuova a ogni
  // render, e usarla come dipendenza staccherebbe e riattaccherebbe
  // l'ascoltatore in continuazione.
  const invio = useRef(onInvio);
  invio.current = onInvio;

  useEffect(() => {
    if (!attivo) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;   // scorciatoie del browser

      // Se si sta scrivendo in un campo, i tasti sono suoi e basta. Senza
      // questo, ogni cifra della password di accesso finiva ANCHE nella
      // casella della camera e preventDefault ne rubava una parte all'input:
      // la password si poteva solo incollare.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
                t.tagName === "SELECT" || t.isContentEditable)) return;

      if (e.key === "Enter")     { e.preventDefault(); invio.current(); return; }
      if (e.key === "Backspace") { e.preventDefault(); set((r) => r.slice(0, -1)); return; }
      if (e.key === "Escape")    { set(""); return; }
      if (ammessi.test(e.key))   { e.preventDefault(); set((r) => (r.length < max ? r + e.key : r)); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attivo, set, max, ammessi]);
}

// ─── Login screen ─────────────────────────────────────────────────────────────

// Il numero che apre l'accesso amministratore invece di entrare in una camera.
// Non è una password — chi lo conosce vede solo il form di login — ma tiene la
// voce fuori dal menu dei residenti, dove non serviva a nessuno di loro.
// 1935: l'anno di fondazione del collegio.
const ROOM_ADMIN = "1935";

function LoginScreen({ lang, onLogin, onAdmin }: {
  theme?: Theme; lang: Lang; onLogin: (room: string) => void; onAdmin: () => void;
}) {
  const t = T[lang];
  const [room, setRoom] = useState("");
  const fg   = "var(--foreground)";
  const sub  = "var(--gray-accessible-text)";
  const chip = "var(--secondary)";
  const surf = "var(--card)";

  function submit() {
    if (room.length === 0) return;
    if (room === ROOM_ADMIN) { setRoom(""); onAdmin(); return; }
    const regexCamera = /^\d+(?:-?[a-bA-B])?$/;
    if (!regexCamera.test(room)) {
      alert("Formato non valido. Esempi validi: 112, 21-b, 112A");
      return;
    }
    onLogin(room);
  }

  // La tastiera fisica: vale sempre in questa schermata. Vedi useTastieraFisica.
  useTastieraFisica(true, setRoom, submit, 6, TASTI_CAMERA);

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6">
      <div className="flex flex-col items-center mb-10">
        <div className="p-4 rounded-3xl mb-5" style={{ background:`color-mix(in srgb, var(--primary) 18%, transparent)` }}>
          <WashingMachine size={36} style={{ color:RED }}/>
        </div>
        <h1 className="text-2xl font-bold mb-1 text-center" style={{ color:fg }}>{t.welcome}</h1>
        <p className="text-sm text-center leading-relaxed" style={{ color:sub }}>
          {t.enterRoom}
        </p>
      </div>

      <div className="w-full rounded-2xl px-5 py-4 mb-5 flex items-center justify-between border" style={{ background:surf, borderColor:"var(--border)" }}>
        <span className="text-sm font-mono" style={{ color:sub }}>{t.room}</span>
        <span className="text-4xl font-mono font-bold tabular-nums" style={{ color:room?fg:`color-mix(in srgb, var(--foreground) 15%, transparent)` }}>
          {room || "—"}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2.5 w-full mb-4">
        {/* setRoom(r => …) e non setRoom(room + k): due tocchi nello stesso
            istante leggerebbero entrambi lo stesso valore vecchio e la prima
            cifra andrebbe persa. Con la forma funzionale si accodano. */}
        {["1","2","3","A", "4","5","6","B", "7","8","9","-"].map((k)=>(
          <button key={k} onClick={()=>setRoom(r=>r.length<6?r+k:r)}
            className="rounded-2xl h-14 text-xl font-bold transition-all active:scale-95"
            style={{ background:chip, color:fg }}>{k}</button>
        ))}
        <button onClick={()=>setRoom(r=>r.slice(0,-1))}
          className="rounded-2xl h-14 flex items-center justify-center transition-all active:scale-95 col-span-1"
          style={{ background:chip, color:sub }}><Delete size={20}/></button>
        <button onClick={()=>setRoom(r=>r.length<6?r+"0":r)}
          className="rounded-2xl h-14 text-xl font-bold transition-all active:scale-95 col-span-1"
          style={{ background:chip, color:fg }}>0</button>
        <button onClick={submit}
          className="rounded-2xl h-14 text-xl font-bold transition-all active:scale-95 text-white col-span-2"
          style={{ background:room.length>0?RED:chip, color:room.length>0?RED_FG:sub }}>→</button>
      </div>

      <button
        onClick={()=>onLogin("")}
        className="w-full py-3.5 rounded-2xl text-sm font-medium transition-all active:scale-[0.98] border"
        style={{ borderColor:"var(--border)", color:sub, background:"transparent" }}>
        {t.skip}
      </button>

      {/* Solo da schermo grande: su un telefono la tastiera fisica non c'è e
          la riga sarebbe un'istruzione impossibile da seguire. */}
      <p className="text-[10px] mt-4 hidden md:block" style={{ color:sub }}>
        {t.usaTastiera}
      </p>

      <p className="text-[10px] font-mono mt-6" style={{ color:sub }}>v. {APP_VERSION} (beta)</p>
    </div>
  );
}

// ─── Barra in fondo (telefono, solo lavanderia) ───────────────────────────────
//
// C'era, e' stata tolta, ed e' tornata — ma non uguale.
//
// La prima versione stava sotto OGNI schermata, comprese cinema, musica e
// polivalente, dove le sue tre voci non volevano dire niente. E si chiamavano
// "Dashboard / Giornaliero / Settimana": nessuna diceva "prenota", che era la
// cosa che la gente cercava — e non trovandola li' finiva sul "+ Prenota"
// accanto alla macchina, che prendeva il turno in corso senza chiedere.
//
// Adesso si prenota dal "+" accanto alle proprie prenotazioni, e queste tre
// voci sono per quello che sono: tre modi di GUARDARE la lavanderia. Percio'
// la barra compare solo dentro la lavanderia, e solo sul telefono — su desktop
// le stesse tre stanno gia' nella sidebar, rientrate sotto la loro struttura.
function BottomNav({ active, onChange, lang }: { active:number; onChange:(i:number)=>void; lang:Lang }) {
  return (
    // paddingBottom con la safe-area: su iPhone l'ultima riga di pulsanti
    // finiva sotto la barra dell'indicatore home, che la copre a meta'. Su
    // tutto il resto env() vale 0 e non cambia niente.
    <div className="flex shrink-0 border-t"
      style={{
        background:"var(--background)", borderColor:"var(--border)",
        paddingBottom:"env(safe-area-inset-bottom, 0px)",
      }}>
      {schermateLavanderia(lang).map((sc, i) => {
        const Icona = sc.icon;
        return (
          <button key={sc.label} onClick={()=>onChange(i)}
            className="flex-1 flex flex-col items-center gap-1 py-3 transition-colors"
            style={{ color: active===i ? RED : "var(--gray-accessible-text)" }}>
            <Icona size={19}/><span className="text-[9px] font-medium tracking-wide">{sc.label}</span>
          </button>
        );
      })}
    </div>
  );
}


// ─── Sidebar desktop ──────────────────────────────────────────────────────────

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );
  useEffect(() => {
    const m = window.matchMedia(query);
    const handler = () => setMatches(m.matches);
    handler();
    m.addEventListener("change", handler);
    return () => m.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

function DesktopSidebar({ active, onChange, lang, roomNumber, showNav, facility, onFacility, adminRole, onChangeRoom, onOpenSettings, onFeedback, onGuasto }: {
  active: number; onChange: (i: number) => void; lang: Lang;
  roomNumber: string | null; showNav: boolean;
  facility: Facility; onFacility: (f: Facility) => void;
  adminRole: AdminRole | null;
  onChangeRoom: () => void; onOpenSettings: () => void; onFeedback: () => void; onGuasto: () => void;
}) {
  const t   = T[lang];
  const fg  = "var(--foreground)";
  const sub = "var(--gray-accessible-text)";
  const div = "var(--border)";
  const tabs = schermateLavanderia(lang);
  return (
    <aside className="w-60 shrink-0 h-dvh flex flex-col border-r" style={{ background:"var(--background)", borderColor:div }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16 shrink-0 border-b" style={{ borderColor:div }}>
        <div className="p-2 rounded-xl" style={{ background:"color-mix(in srgb, var(--primary) 15%, transparent)" }}>
          <WashingMachine size={20} style={{ color:RED }}/>
        </div>
        <span className="text-lg font-bold" style={{ color:fg }}>Sez. Valentino</span>
      </div>

      {/* Navigazione */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        {/* Strutture: Lavanderia / Cinema / Musica / Polivalente.
            Le schede Dashboard/Giornaliero/Settimana sono annidate subito
            sotto il pulsante Lavanderia (rientrate, e solo mentre e' la
            struttura attiva) invece che spuntare in coda a tutte le
            strutture: prima Cinema, Musica e Polivalente stavano IN MEZZO fra
            Lavanderia e le sue stesse schede, e non si capiva a chi
            appartenessero. Su mobile la stessa cosa e' ovvia perche' la barra
            in basso cambia con la struttura scelta sopra; qui replichiamo lo
            stesso legame visivo con il rientro. */}
        {showNav && FACILITIES.map(({ id, icon: Icon, chiave }) => {
          const isActive = facility === id;
          return (
            <div key={id}>
              <button onClick={()=>onFacility(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${isActive ? "" : "desk-nav"}`}
                style={isActive ? { background:RED, color:RED_FG } : { color:sub }}>
                <Icon size={18}/>{T[lang][chiave]}
              </button>
              {/* Sempre visibile, non solo quando la lavanderia è la sezione
                  attiva: comparendo e sparendo faceva saltare in su e in giù
                  tutte le voci sotto, e da Cinema non si vedeva più che quelle
                  tre schede esistono. Toccarne una porta in lavanderia. */}
              {id === "laundry" && (
                <div className="flex flex-col gap-1 mt-1 pl-3 ml-3.5 border-l" style={{ borderColor:div }}>
                  {tabs.map((tab, i) => {
                    const TabIcon = tab.icon;
                    const tabAttiva = isActive && active === i;
                    return (
                      <button key={i} onClick={()=>{ onFacility("laundry"); onChange(i); }}
                        className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-colors text-left ${tabAttiva ? "" : "desk-nav"}`}
                        style={tabAttiva ? { background:`color-mix(in srgb, var(--primary) 15%, transparent)`, color:RED } : { color:sub }}>
                        <TabIcon size={15}/>{tab.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Sezioni amministrative: stesso livello delle strutture, in coda e
            separate perché sono di natura diversa. Compaiono solo con una
            sessione attiva; l'uscita sta dentro la sezione stessa. */}
        {showNav && adminSectionsFor(adminRole).length > 0 && (
          <>
            <div className="h-px my-2 mx-2" style={{ background:div }}/>
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color:sub }}>
              {T[lang].amministrazione}
            </p>
            {adminSectionsFor(adminRole).map(({ id, icon: Icon, chiave }) => {
              const isActive = facility === id;
              return (
                <button key={id} onClick={()=>onFacility(id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${isActive ? "" : "desk-nav"}`}
                  style={isActive ? { background:RED, color:RED_FG } : { color:sub }}>
                  <Icon size={18}/>{T[lang][chiave]}
                </button>
              );
            })}
          </>
        )}
      </nav>

      {/* Controlli */}
      <div className="px-3 py-4 border-t flex flex-col gap-2 shrink-0" style={{ borderColor:div }}>
        {roomNumber !== null && (
          <button onClick={onChangeRoom}
            className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors desk-nav"
            style={{ color:fg }}>
            <span className="font-mono">{roomLabel(roomNumber, t)}</span>
            <LogOut size={13} style={{ color:sub }}/>
          </button>
        )}
        {/* Lingua, notifiche, installazione, accessibilità stanno tutte dentro
            Impostazioni. Il refresh manuale è sparito (tornare sull'app ricarica
            già i dati) e il tema segue sempre quello del sistema. */}
        <button onClick={onGuasto}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors desk-nav"
          style={{ color:fg }}>
          <Wrench size={16} style={{ color:sub }}/>{T[lang].reportOos}
        </button>
        <button onClick={onOpenSettings}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors desk-nav"
          style={{ color:fg }}>
          <Settings size={16} style={{ color:sub }}/>{T[lang].impostazioni}
        </button>
        {/* Come nel menu del telefono: il feedback sull'app sta fra i
            controlli, non fra le destinazioni. */}
        <button onClick={onFeedback}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors desk-nav"
          style={{ color:fg }}>
          <MessageSquare size={16} style={{ color:sub }}/>{T[lang].feedbackApp}
        </button>
        <p className="text-center text-[10px] font-mono pt-1" style={{ color:sub }}>v. {APP_VERSION} (beta)</p>
      </div>
    </aside>
  );
}

// ─── Stati di caricamento / errore ─────────────────────────────────────────────

function CenterState({ children }: { isDark?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4"
      style={{ color:"var(--gray-accessible-text)" }}>
      {children}
    </div>
  );
}

// ─── Selettore struttura (Lavanderia / Cinema / Musica) ───────────────────────

//  e non l'etichetta: i testi stanno tutti in lingue/, e con sei
// lingue un oggetto { it, en } scritto qui dentro non reggeva piu'.
const FACILITIES: {
  id: Facility; icon: any;
  chiave: "navLavanderia" | "navCinema" | "navMusica" | "navConferenze";
}[] = [
  { id: "laundry",    icon: WashingMachine, chiave: "navLavanderia" },
  { id: "cinema",     icon: Film,           chiave: "navCinema" },
  { id: "music",      icon: Music,          chiave: "navMusica" },
  // La sala conferenze non si prenota: la programma la direzione e qui la si
  // guarda. Sta comunque fra le strutture perche' la domanda che ci si fa
  // ("e' libera adesso?") e' la stessa che si fa per le altre.
  { id: "conferenze", icon: Presentation,   chiave: "navConferenze" },
];

// Le voci riservate al sistemista non compaiono con la sessione FDO, ma il
// controllo vero resta sul server: nascondere una voce non è un'autorizzazione.
const ADMIN_SECTIONS: {
  id: AdminTab; icon: any;
  chiave: "navMacchine" | "navSegnalazioni" | "navAccount" | "navRicorrenti" | "navManutenzione";
  sistemistaOnly?: boolean;
  // Macchine e segnalazioni restano affari di FDO e sistemista: lo staff
  // prenota per conto della Direzione come l'FDO, ma non deve vedere lo
  // stato guasto/funzionante delle macchine ne' le segnalazioni.
  staffEsclusa?: boolean;
}[] = [
  { id: "macchine",       icon: Wrench,        chiave: "navMacchine",     staffEsclusa: true },
  { id: "segnalazioni",   icon: MessageSquare, chiave: "navSegnalazioni", staffEsclusa: true },
  // La programmazione della sala polivalente non e' piu' una scheda a se':
  // vive dentro la sezione "Polivalente" stessa (vedi Conferenze.tsx), visibile
  // li' a chiunque abbia una sessione admin — non serve piu' una voce qui.
  // Chi crea e disattiva gli account e' una decisione dello stesso livello di
  // "chi puo' cancellare tutto": resta al sistemista.
  { id: "account",        icon: UserCog,       chiave: "navAccount",      sistemistaOnly: true },
  { id: "ricorrenti",     icon: Repeat,        chiave: "navRicorrenti",   sistemistaOnly: true },
  { id: "manutenzione",   icon: Eraser,        chiave: "navManutenzione", sistemistaOnly: true },
];

const adminSectionsFor = (role: AdminRole | null) =>
  role === null ? [] : ADMIN_SECTIONS.filter((s) =>
    (!s.sistemistaOnly || role === "sistemista") && (!s.staffEsclusa || role !== "staff")
  );

// Le tre schermate della lavanderia. Stanno qui perche' le nominano sia il
// menu del telefono sia la sidebar del desktop, e due elenchi che devono
// restare uguali sono un elenco solo.
const schermateLavanderia = (lang: Lang) => [
  { icon: Clock,        label: "Dashboard" },
  { icon: CalendarDays, label: T[lang].daily },
  { icon: LayoutGrid,   label: T[lang].weekly },
];

// Il menu laterale, su telefono.
//
// Le quattro strutture stavano in una griglia di pastiglie sotto l'orario, e
// con una sessione admin diventavano otto: mezza schermata di navigazione
// prima di arrivare al contenuto, ogni volta, anche per chi apre l'app solo
// per vedere se la lavatrice e' libera. Ora stanno dietro un pulsante, come la
// camera e le impostazioni: sono destinazioni, e una destinazione la si cerca
// quando serve.
//
// E' il gemello della sidebar del desktop — stesse voci, stesso ordine, stesse
// regole su chi vede cosa. Manca solo l'annidamento delle schede della
// lavanderia: quelle non ci sono piu' da nessuna parte, si arriva al
// giornaliero e alla settimana dai due pulsanti della dashboard.
function MenuStrutture({ aperto, onClose, facility, onChange, lang, adminRole, onFeedback, onImpostazioni, onGuasto }: {
  aperto: boolean; onClose: ()=>void;
  facility: Facility; onChange: (f: Facility)=>void;
  lang: Lang; adminRole: AdminRole | null;
  onFeedback: ()=>void; onImpostazioni: ()=>void; onGuasto: ()=>void;
}) {
  const sub      = "var(--gray-accessible-text)";
  const div      = "var(--border)";
  const sections = adminSectionsFor(adminRole);

  if (!aperto) return null;

  const Voce = ({ id, icon: Icon, label }: { id: Facility; icon: any; label: string }) => {
    const attiva = facility === id;
    return (
      <button onClick={()=>{ onChange(id); onClose(); }}
        className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-colors text-left"
        style={attiva ? { background:RED, color:RED_FG } : { color:sub }}>
        <Icon size={18} className="shrink-0"/>{label}
      </button>
    );
  };

  return (
    <>
      {/* Il velo chiude il menu. Sta sotto al pannello e sopra a tutto il
          resto: senza, si poteva toccare la pagina dietro con il menu
          ancora aperto. */}
      <div className="absolute inset-0 z-40 menu-velo" onClick={onClose} aria-hidden="true"
        style={{ background:"rgba(0,0,0,.45)" }}/>

      <nav className="absolute inset-y-0 left-0 z-50 w-[80%] max-w-[300px] flex flex-col border-r menu-pannello"
        style={{ background:"var(--background)", borderColor:div }}
        aria-label={T[lang].navStrutture}>
        <div className="flex items-center justify-between px-4 pt-5 pb-3 shrink-0" style={{ borderBottom:`1px solid ${div}` }}>
          <span className="text-base font-bold" style={{ color:"var(--foreground)" }}>Sez. Valentino</span>
          <button onClick={onClose} aria-label={T[lang].cancel}
            className="p-1.5 rounded-lg" style={{ color:sub }}>
            <X size={18}/>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 flex flex-col gap-1">
          {FACILITIES.map(({ id, icon, chiave }) => (
            <Voce key={id} id={id} icon={icon} label={T[lang][chiave]}/>
          ))}

          {/* Le sezioni amministrative in coda e separate: stesso livello
              delle strutture, natura diversa. Compaiono solo con una
              sessione attiva — ma il controllo vero resta sul server. */}
          {sections.length > 0 && (
            <>
              <div className="my-2 mx-3 border-t" style={{ borderColor:div }}/>
              {sections.map(({ id, icon, chiave }) => (
                <Voce key={id} id={id} icon={icon} label={T[lang][chiave]}/>
              ))}
            </>
          )}
        </div>

        {/* In fondo, dopo una riga: non e' un posto dell'app, e' un modo di
            scrivere a chi l'app la fa. Stava fra i pulsanti della dashboard,
            dove sembrava una funzione della lavanderia come le altre — e si
            chiamava solo "Feedback", che non diceva su cosa. */}
        <div className="shrink-0 px-3 py-3 flex flex-col gap-1" style={{ borderTop:`1px solid ${div}` }}>
          {/* L'ingranaggio stava in alto a destra, accanto alla camera: due
              icone per due cose diverse, di cui una si usa una volta all'anno.
              Qui sta con le altre cose che non sono destinazioni. */}
          <button onClick={()=>{ onGuasto(); onClose(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left"
            style={{ color:sub }}>
            <Wrench size={18} className="shrink-0"/>{T[lang].reportOos}
          </button>
          <button onClick={()=>{ onImpostazioni(); onClose(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left"
            style={{ color:sub }}>
            <Settings size={18} className="shrink-0"/>{T[lang].impostazioni}
          </button>
          <button onClick={()=>{ onFeedback(); onClose(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left"
            style={{ color:sub }}>
            <MessageSquare size={18} className="shrink-0"/>{T[lang].feedbackApp}
          </button>
          <p className="text-center text-[10px] font-mono pt-1" style={{ color:sub }}>v. {APP_VERSION} (beta)</p>
        </div>
      </nav>
    </>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]   = useState(0);
  // La dashboard e' `memo`: un callback creato al volo nel JSX cambierebbe a
  // ogni render e la farebbe ridisegnare da capo.
  const vaiAllaSettimana = useCallback(() => setScreen(2), []);
  // 0 dashboard, 1 giornaliero, 2 settimana. Con useCallback perche' le tre
  // viste sono `memo`: un callback creato al volo dentro il JSX cambierebbe a
  // ogni render e le farebbe ridisegnare da capo — cioe' proprio il lavoro che
  // quel memo evita (la griglia settimanale sono 7x19 celle).
  const [facility, setFacility] = useState<Facility>("laundry");
  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuAperto, setMenuAperto] = useState(false);   // il menu laterale, solo su telefono
  // Il feedback sull'app: sta fra i controlli (menu laterale e sidebar), non
  // piu' fra i pulsanti in fondo alla dashboard. Lo stato vive qui perche' da
  // li' lo aprono tutti e due i layout.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [guastoOpen, setGuastoOpen]     = useState(false);
  const [_aPrefs, _setAPrefs] = useState<AccessibilityPrefs>(loadPrefs);
  // Il tema segue sempre quello del telefono: niente più selettore manuale né
  // preferenza salvata. Un secondo interruttore che duplica un'impostazione
  // che il sistema operativo offre già non aggiunge nulla, e rischia solo di
  // restare "bloccato" su una scelta vecchia quando l'utente cambia tema al
  // telefono altrove.
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light"
  );
  const [lang,   setLang]     = useState<Lang>(linguaIniziale);
  const [roomNumber] = useState<string | null>(() => {
    try { return localStorage.getItem("laundryhub.room"); } catch { return null; }
  });
  const [week,   setWeek]     = useState<WeekData>({});
  const [status, setStatus]   = useState<StatusData>({});
  const [loading, setLoading] = useState(true);
  const [error,  setError]    = useState<string | null>(null);
  // Preferiti caricati in base alla camera corrente (vedi loadFavs).
  const [favs,   setFavs]     = useState<Fav[]>(() => loadFavs(
    (() => { try { return localStorage.getItem("laundryhub.room"); } catch { return null; } })()
  ));
  const t = T[lang];

  // Quando cambia la stanza (login/logout/cambio camera) ricarico i preferiti
  // di QUELLA stanza, evitando di mostrare quelli della stanza precedente.
  useEffect(() => { setFavs(loadFavs(roomNumber)); }, [roomNumber]);

  const toggleFav = useCallback((day: number, slot: number) => {
    setFavs((prev) => {
      const exists = prev.some((f) => f.day === day && f.slot === slot);
      const next = exists
        ? prev.filter((f) => !(f.day === day && f.slot === slot))
        : [...prev, { day, slot }].sort((a, b) => a.day - b.day || a.slot - b.slot);
      try { if (roomNumber) localStorage.setItem(favsKey(roomNumber), JSON.stringify(next)); } catch {}
      return next;
    });
  }, [roomNumber]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Se l'utente cambia tema al telefono MENTRE l'app è aperta, si adegua
  // subito invece di aspettare una ricarica.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Applica preferenze accessibilità al DOM al mount
  useEffect(() => { applyToDOM(accessibilityPrefs); }, []);

  const handleAccessibilityChange = useCallback((prefs: AccessibilityPrefs) => {
    accessibilityPrefs = prefs;  // aggiorna riferimento modulo per i componenti figli
    _setAPrefs(prefs);           // trigger re-render
    savePrefs(prefs);
    applyToDOM(prefs);
  }, []);
  
  const refresh = useCallback(async () => {
    try {
      const s = await api.getSnapshot();
      setWeek(s.week); setStatus(s.status); setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Il pulsante di refresh manuale è sparito: "torno sull'app e si aggiorna
  // da sola" è vero solo se riaprirla fa davvero un caricamento nuovo. Senza
  // il pulsante, un'app lasciata aperta in background per ore manterrebbe
  // TODAY_DOW/CUR_SLOT calcolati al vecchio caricamento — sono valori fissati
  // all'avvio e non si aggiornano da soli al passare del tempo. Qui si
  // ricarica automaticamente quando l'app torna in primo piano dopo essere
  // rimasta nascosta più di 5 minuti, così l'assunzione diventa vera davvero.
  useEffect(() => {
    let hiddenAt: number | null = null;
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && Date.now() - hiddenAt > 5 * 60_000) {
        window.location.reload();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Se questo dispositivo ha una sessione admin valida, l'app offre in più la
  // prenotazione a nome DIREZIONE e le voci riservate nel menu. Un solo
  // controllo qui, propagato a chi ne ha bisogno — il vero controllo resta
  // comunque sul cookie lato server: nascondere un pulsante non è
  // un'autorizzazione.
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const isAdmin = adminRole !== null;
  useEffect(() => { api.adminRole().then((r) => setAdminRole((r as AdminRole) ?? null)); }, []);

  // Chi esce (o la cui sessione scade) mentre sta guardando una sezione
  // riservata non deve restare su una schermata che non gli appartiene più:
  // lo si riporta in lavanderia. Vale anche per il passaggio sistemista→FDO,
  // che perde Ricorrenti e Manutenzione.
  useEffect(() => {
    if (isAdminFacility(facility) &&
        !adminSectionsFor(adminRole).some((s) => s.id === facility)) {
      setFacility("laundry");
    }
  }, [adminRole, facility]);

  // Un solo punto in cui la sessione amministrativa cambia, da qualunque parte
  // arrivi (login, uscita, scadenza rilevata da una sezione). Chi smette di
  // essere amministratore smette anche di essere la DIREZIONE: senza questo
  // resterebbe con un'identità che non può più usare, e ogni prenotazione
  // fallirebbe lato server senza che si capisca perché.
  const handleAdminSession = useCallback((r: AdminRole | null) => {
    setAdminRole(r);
    // Traccia locale: dice ad adminRole() se al prossimo avvio vale la pena
    // chiedere al server. Vedi il commento in api.ts — non è autorizzazione.
    api.markAdminSeen(r !== null);
    if (r === null && localStorage.getItem("laundryhub.room") === api.DIREZIONE) {
      try { localStorage.removeItem("laundryhub.room"); } catch {}
      window.location.reload();
    }
  }, []);

  // L'uscita dalla modalità amministratore non ha più un pulsante suo: la fa
  // changeRoom(), cioè il pulsante della camera in alto. Vedi lì.

  // Riallinea in silenzio la subscription push col server.
  //
  // Due motivi: il nuovo database parte senza le subscription vecchie, e la
  // chiave VAPID è cambiata — in entrambi i casi chi aveva i promemoria attivi
  // smetterebbe di riceverli senza alcun segnale, perché il browser continua a
  // mostrarli come attivi. Girando a ogni avvio, ogni dispositivo si ripara da
  // solo la prima volta che qualcuno apre l'app.
  useEffect(() => {
    if (!roomNumber) return;
    push.refreshSubscription(roomNumber);
  }, [roomNumber]);

  function chooseRoom(room: string) {
    try { localStorage.setItem("laundryhub.room", room); } catch {}
    window.location.reload();
  }
  // Cambiare camera chiude anche la sessione amministrativa.
  //
  // Prima no, e il risultato era incoerente: "Esci" terminava la sessione,
  // "Cambia camera" lasciava la modalità amministratore attiva sotto un'altra
  // identità. Chi lascia la postazione tocca il pulsante che ha davanti, non
  // quello giusto in teoria — e un dispositivo condiviso restava con i poteri
  // di chi c'era prima. La sessione vive nel cookie, non nella camera: va
  // chiusa sul server, non basta dimenticare il numero.
  async function changeRoom() {
    if (adminRole !== null) {
      try {
        const { adminLogout } = await import("./AdminPanel");
        await adminLogout();
      } catch { /* offline: si esce comunque dalla camera */ }
    }
    try { localStorage.removeItem("laundryhub.room"); } catch {}
    window.location.reload();
  }

  // Un solo punto d'ingresso per tutte e tre le viste: se la camera è
  // DIREZIONE la richiesta passa dall'endpoint amministrativo (autorizzato dal
  // cookie di sessione, non dal client), altrimenti dal percorso normale.
  const handleBook = useCallback(async (day:number, slot:number, machine:string, room:string) => {
    const s = room === api.DIREZIONE
      ? await api.bookAsDirezione(day, slot, machine)
      : await api.book(day, slot, machine, room);
    setWeek(s.week); setStatus(s.status);
  }, []);
  /**
   * Libera un turno.
   *
   * Per i residenti resta permissiva come sempre: senza login la camera è
   * autodichiarata, quindi un controllo di proprietà si aggirerebbe cambiando
   * una stringa nel browser.
   *
   * L'unica eccezione sono i turni della DIREZIONE, che il server protegge:
   * lì l'identità è verificata davvero, quindi difenderla ha senso. Chi ha la
   * sessione passa dal percorso amministrativo e può toglierli; gli altri
   * ricevono "riservata alla direzione".
   */
  const handleClear = useCallback(async (day:number, slot:number, machine:string) => {
    // Il percorso amministrativo si usa SOLO quando serve davvero, cioè su un
    // turno della Direzione. Per tutto il resto va bene quello pubblico, anche
    // per un amministratore: così l'unica strada che richiede la migrazione
    // 006 è quella che quella migrazione introduce, e nient'altro cambia
    // comportamento nel frattempo.
    const diChiE = week[day]?.[slot]?.[machine];
    const s = isAdmin && diChiE === api.DIREZIONE
      ? await api.clearAsDirezione(day, slot, machine)
      : await api.clearBooking(day, slot, machine);
    setWeek(s.week); setStatus(s.status);
  }, [isAdmin, week]);
  // Il residente segnala il guasto, non cambia lo stato: la segnalazione finisce
  // fra i feedback e un amministratore decide. Lo stato mostrato non cambia
  // subito, ed e' corretto cosi' — cambiera' quando l'admin l'avra' verificato.
  const handleStatus = useCallback(async (machine:string, _oos:boolean, nota?:string) => {
    await api.reportBroken(machine, nota);
  }, []);

  /**
   * Se mostrare la navigazione (barra in basso, selettore struttura, sidebar).
   *
   * Dipende SOLO dall'aver scelto una camera. Prima era
   * `roomNumber !== null && !loading && !error`, e quel `!error` era il motivo
   * per cui la barra in basso "spariva ogni tanto":
   *
   *   1. l'app è aperta e funziona, poi un refresh fallisce — basta un attimo
   *      di rete ballerina, un ascensore, il passaggio wifi/dati;
   *   2. `error` si popola e TUTTA la navigazione si smonta;
   *   3. se in quel momento eri su Cinema o Musica, il corpo continua a
   *      mostrare la sala (il ramo d'errore vale solo per la lavanderia),
   *      quindi restavi su una schermata senza più alcun modo di uscirne.
   *
   * Un errore di rete transitorio non è un buon motivo per togliere di mezzo
   * la navigazione: i dati già caricati sono ancora in `week`/`status` e
   * restano validi. L'errore va detto nel corpo, dove c'è il pulsante Riprova,
   * non facendo sparire i comandi.
   */
  const showChrome = roomNumber !== null;
  const isDesktop  = useMediaQuery("(min-width: 768px)");

  const globalStyle = (
    <style>{`
      @keyframes toast-in{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
      .animate-toast-in{animation:toast-in .22s ease}
      @keyframes spin{to{transform:rotate(360deg)}}
      .animate-spin-slow{animation:spin 1s linear infinite}
      *{scrollbar-width:none}*::-webkit-scrollbar{display:none}
      .desk-nav{transition:background .15s ease}
      .desk-nav:hover{background:var(--secondary)}
    `}</style>
  );

  const mainContent = loading ? (
    <CenterState>
      <Loader2 size={28} className="animate-spin-slow" style={{ color:RED }}/>
      <p className="text-sm">{t.loading}</p>
    </CenterState>
  ) : error ? (
    <CenterState>
      <AlertTriangle size={28} style={{ color:OOS_T }}/>
      <p className="text-sm">{t.netError}</p>
      <p className="text-xs mt-2" style={{ color: "#888", userSelect: "text" }}>{error}</p>
      <button onClick={()=>{ setLoading(true); refresh(); }}
        className="mt-1 rounded-xl px-4 py-2 text-sm font-semibold" style={{ background:RED, color:RED_FG }}>
        {t.retry}
      </button>
    </CenterState>
  ) : roomNumber === null ? (
    <LoginScreen lang={lang} onLogin={chooseRoom} onAdmin={() => setAdminLoginOpen(true)}/>
  ) : (
    <>
      {screen===0 && <Dashboard   theme={theme} lang={lang} week={week} status={status} roomNumber={roomNumber} favs={favs} onToggleFav={toggleFav} onBook={handleBook} onClear={handleClear} onGoWeek={vaiAllaSettimana}/>}
      {screen===1 && <DaySchedule theme={theme} lang={lang} week={week} status={status} roomNumber={roomNumber} favs={favs} onToggleFav={toggleFav} onBook={handleBook} onClear={handleClear} isAdmin={isAdmin}/>}
      {screen===2 && <WeekOverview theme={theme} lang={lang} week={week} status={status} roomNumber={roomNumber} onBook={handleBook} onClear={handleClear} isAdmin={isAdmin}/>}
    </>
  );

  // Lavanderia → schermate laundry; Cinema/Musica/Conferenze → sala a corpo
  // intero; sezioni riservate → pannello amministrativo, nello stesso corpo
  // pagina. Un if/else unico invece di due booleani (isRoom, isPienaPagina)
  // derivati dallo stesso confronto ripetuto: quella forma confondeva il
  // narrowing di TypeScript, che finiva per segnare "conferenze" irraggiungibile.
  //
  // `isPienaPagina` e' sparito con la barra in fondo: serviva solo a nasconderla
  // nelle viste a corpo intero, e adesso non c'e' piu' niente da nascondere.
  let bodyContent: React.ReactNode;
  if (isAdminFacility(facility)) {
    // px-5 come le sezioni della lavanderia: senza, le schede amministrative
    // toccavano i bordi dello schermo sul telefono — il corpo pagina non ha
    // padding proprio, se lo mettono le viste.
    // pt-4 oltre al px-5: le altre viste cominciano con un'intestazione che
    // porta il suo margine, le sezioni amministrative no e partivano incollate
    // ai selettori qui sopra.
    bodyContent = <div className="px-5 pt-4"><Suspense fallback={null}><AdminScreens tab={facility} onSession={handleAdminSession}/></Suspense></div>;
  } else if (facility === "conferenze") {
    bodyContent = <Conferenze lang={lang} adminRole={adminRole}/>;
  } else if (facility === "cinema" || facility === "music") {
    bodyContent = <RoomView room={facility} lang={lang} roomNumber={roomNumber}/>;
  } else {
    bodyContent = mainContent;
  }

  // Pannello accessibilità (modale, condiviso tra mobile e desktop)
  const accessibilityModal = accessibilityOpen && (
    <AccessibilityPanel
      lang={lang}
      prefs={_aPrefs}
      onPrefsChange={handleAccessibilityChange}
      onClose={() => setAccessibilityOpen(false)}
    />
  );

  // Menu e schermate amministrative: identici nei due layout, definiti una
  // volta sola invece che copiati in entrambi i rami.
  const settingsSheet = settingsOpen && (
    <SettingsSheet lang={lang} room={roomNumber}
      adminRole={adminRole}
      onLang={(l)=>{ setLang(l); salvaLingua(l); }}
      onAccessibility={() => setAccessibilityOpen(true)}
      onClose={() => setSettingsOpen(false)} />
  );

  // Login amministratore: si apre digitando 1935 al posto della camera.
  // Chi amministra non ha una camera propria: la sua identità è DIREZIONE, e
  // con quella prenota — turni di lavanderia e sale — senza dover scegliere
  // ogni volta per conto di chi sta agendo.
  // Un guasto capita due volte l'anno: la chiave inglese su ognuna delle sei
  // righe era un comando permanente per un caso raro. Sta con le altre cose
  // che si fanno di rado — impostazioni, feedback — dietro il menu.
  const guastoSheet = guastoOpen && (
    <SegnalaGuastoSheet lang={lang} status={status} onStatus={handleStatus}
      roomNumber={roomNumber} onClose={() => setGuastoOpen(false)}/>
  );

  const feedbackModal = feedbackOpen && (
    <FeedbackModal lang={lang} room={roomNumber} onClose={() => setFeedbackOpen(false)}/>
  );

  const adminLoginSheet = adminLoginOpen && (
    <Suspense fallback={null}>
      <AdminLoginSheet
        onClose={() => setAdminLoginOpen(false)}
        onSession={(r) => {
          handleAdminSession(r);
          if (r && roomNumber !== api.DIREZIONE) chooseRoom(api.DIREZIONE);
        }} />
    </Suspense>
  );

  if (isDesktop) {
    return (
      <div className="relative h-dvh w-full flex overflow-hidden"
        style={{ fontFamily:"'DM Sans', sans-serif", background:"var(--background)" }}>
        {globalStyle}
        {showChrome && <InstallPrompt lang={lang}/>}
        {accessibilityModal}
        {settingsSheet}
        {adminLoginSheet}
        {feedbackModal}
        {guastoSheet}
        <DesktopSidebar
          active={screen} onChange={setScreen} lang={lang}
          roomNumber={roomNumber} showNav={showChrome}
          facility={facility} onFacility={setFacility}
          adminRole={adminRole}
          onChangeRoom={changeRoom}
          onOpenSettings={() => setSettingsOpen(true)}
          onFeedback={() => setFeedbackOpen(true)}
          onGuasto={() => setGuastoOpen(true)}
        />
        <main className="flex-1 h-dvh min-h-0 flex flex-col overflow-y-auto overscroll-contain">
          {/* Era max-w-6xl (1152px): su uno schermo grande restavano centinaia
              di pixel vuoti ai lati mentre la griglia settimanale stava
              stretta. 1600px sfrutta lo spazio senza arrivare al bordo su
              monitor molto larghi, dove le righe diventerebbero illeggibili
              da seguire con l'occhio. */}
          <div className="mx-auto w-full max-w-[1600px] flex-1 min-h-0 flex flex-col px-4 lg:px-8">
            {bodyContent}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh w-full flex items-center justify-center md:py-8"
      style={{ fontFamily:"'DM Sans', sans-serif", background:"var(--muted)" }}>
      {globalStyle}
      <div className="relative flex flex-col overflow-hidden w-full h-dvh md:h-[844px] md:max-w-[420px] md:rounded-[3rem] md:shadow-2xl md:border"
        style={{ background:"var(--background)", borderColor:"var(--border)" }}>
        {showChrome && <InstallPrompt lang={lang}/>}
        {accessibilityModal}
        {settingsSheet}
        {adminLoginSheet}
        {feedbackModal}
        {guastoSheet}

        <div className="flex items-center justify-between px-7 pt-3 pb-0 shrink-0 mt-2 md:mt-0">
          {/* Prima di scegliere una camera qui c'era un orologio finto (9:41,
              lo stesso hardcoded in ogni mockup Apple): non è mai stata l'ora
              vera e non serviva a niente, solo confondeva. */}
          {/* A sinistra: il menu delle strutture e dove ci si trova adesso.
              Il nome serve proprio perche' le pastiglie non ci sono piu': senza,
              aprendo Cinema non ci sarebbe piu' niente che dica "sei nel
              cinema". */}
          <div className="flex items-center gap-2 min-w-0">
            {showChrome && (
              <button onClick={() => setMenuAperto(true)} aria-label={T[lang].navStrutture}
                className="p-1.5 -ml-1.5 rounded-lg transition-colors" style={{ color:"var(--gray-accessible-text)" }}>
                <Menu size={18}/>
              </button>
            )}
            {showChrome && (
              <span className="text-sm font-bold truncate" style={{ color:"var(--foreground)" }}>
                {isAdminFacility(facility)
                  ? T[lang][ADMIN_SECTIONS.find((x) => x.id === facility)!.chiave]
                  : T[lang][FACILITIES.find((x) => x.id === facility)!.chiave]}
              </span>
            )}
          </div>
          <div className="w-24 h-6 rounded-full hidden md:flex items-center justify-center" style={{ background:"var(--secondary)" }}>
            <div className="w-3 h-3 rounded-full border" style={{ background:"var(--background)", borderColor:"var(--border)" }}/>
          </div>
          {/* Il refresh manuale è sparito: tornare sull'app ricarica già i
              dati da sola. Il tema segue sempre quello del telefono. Lingua,
              notifiche, installazione e accessibilità stanno tutte dentro
              Impostazioni, invece di quattro-cinque icone separate. */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Il saluto vive qui adesso, non piu' in una riga sua sopra la
                dashboard: "Buonasera, Camera 318" invece di due pezzi
                separati che dicevano in fondo la stessa cosa — chi sei e che
                ora e' — gia' scritta nella barra di stato del telefono. */}
            {roomNumber !== null && (
              <button onClick={changeRoom}
                className="text-[11px] font-mono px-2 py-1 rounded-lg transition-colors"
                style={{ background:"var(--secondary)", color:"var(--gray-accessible-text)" }}>
                {T[lang].greeting(new Date().getHours())}, {roomNumber === api.DIREZIONE ? T[lang].direzioneNome : `${T[lang].camera} ${roomNumber}`}
              </button>
            )}
          </div>
        </div>

        <MenuStrutture aperto={menuAperto} onClose={() => setMenuAperto(false)}
          facility={facility} onChange={setFacility} lang={lang} adminRole={adminRole}
          onFeedback={() => setFeedbackOpen(true)}
          onImpostazioni={() => setSettingsOpen(true)}
          onGuasto={() => setGuastoOpen(true)}/>

        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 flex flex-col mt-2">
          {bodyContent}
        </div>

        {/* Solo dentro la lavanderia: altrove quelle tre voci non vogliono dire
            niente, ed era il difetto della versione precedente. */}
        {showChrome && facility === "laundry" && (
          <BottomNav active={screen} onChange={setScreen} lang={lang}/>
        )}

        <div className="pb-2 hidden md:flex justify-center shrink-0">
          <div className="w-28 h-1 rounded-full" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        </div>
      </div>
    </div>
  );
}