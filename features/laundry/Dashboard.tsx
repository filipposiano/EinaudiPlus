import { useState, useEffect, memo } from "react";
import { Plus, Trash2, Star, History, AlertTriangle, Wind } from "lucide-react";
import { WashingMachine } from "../../icons";
import { FavPicker } from "./FavPicker";
import { QuickBookModal } from "./QuickBookModal";
import { Toast } from "../../pannelli";
import * as api from "../../api";
import {
  TIME_SLOTS, WEEKLY_QUOTA, TODAY_DOW, CUR_SLOT, DAYS_DATE, monShort, slotEndDate,
  machinesFor, deriveMachines,
  myWeekBookings, isPastBooking, isCurrentBooking,
  type WeekData, type StatusData, type Machine,
  type MyBooking, type Fav,
} from "../../modello";
import { T, errMsg, type Lang } from "../../i18n";
import {
  RED, GREEN, ORANGE,
  GREEN_T, YELLOW_T, OOS_T, ORANGE_T, type Theme,
} from "../../tema";

// ─── Dashboard ─────────────────────────────────────────────────────────────────

// memo, qui e sulle altre due viste: ricevono prop stabili — `week` e `status`
// cambiano solo a un caricamento nuovo, i callback sono useCallback in App.
// Senza, bastava aprire Impostazioni o far comparire un pannello per
// ridisegnare da capo anche la griglia settimanale, che sono 7x19 celle: lavoro
// buttato, e su un telefono lento si sente.
export const Dashboard = memo(function Dashboard({ lang, week, status, roomNumber, favs, onToggleFav, onBook, onClear, onGoDay }: {
  theme: Theme; lang: Lang; week: WeekData; status: StatusData; roomNumber: string;
  favs: Fav[]; onToggleFav: (day:number, slot:number)=>void;
  onBook: (day:number, slot:number, machine:string, room:string)=>Promise<void>;
  onClear: (day:number, slot:number, machine:string)=>Promise<void>;
  // Porta al giornaliero: e' la vista con le fasce di oggi gia' davanti,
  // il posto piu' diretto per prenotare un turno adesso. Chi vuole guardare
  // tutta la settimana passa dall'interruttore in cima a quella pagina.
  onGoDay: ()=>void;
}) {
  const t = T[lang];
  const [now, setNow]           = useState(new Date());
  const [toast, setToast]       = useState<string | null>(null);
  const [toastUndo, setToastUndo] = useState<(() => void) | null>(null);
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
  // Anche i turni gia' passati (di questa settimana) restano cancellabili: chi
  // ha saltato un turno o ha prenotato per sbaglio deve poter liberare la
  // quota senza aspettare che scompaia da solo a fine settimana. Vanno dopo
  // gli attivi e in ordine dal piu' recente, cosi' l'elenco resta guidato dal
  // "cosa mi serve adesso" e il passato non lo seppellisce.
  const pastBookings   = myBookings.filter(isPastBooking).slice().reverse();
  const displayBookings = [...activeBookings, ...pastBookings];

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
    setToast(t.slotConfirmed);
    setToastUndo(() => () => { onClear(day, s, mid).catch((e) => setToast(errMsg(e, lang))); });
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
  // Tutti i preferiti, con lo stato di ciascuno: libero (con la sigla di chi
  // lo prenderesti), pieno, o passato. Prima si vedevano solo quelli liberi —
  // gli altri sparivano del tutto dalla dashboard, e chi ne aveva segnato uno
  // pieno o passato non trovava piu' traccia di averlo salvato.
  const preferitiConStato = favs
    .map((f) => {
      const passato = isPastBooking({ day: f.day, slot: f.slot, mid: "W-A" });
      return { ...f, passato, mid: passato ? null : firstFreeWasherAt(f.day, f.slot) };
    })
    // Giorno e fascia crescono insieme al tempo: ordinare per (giorno, fascia)
    // ordina per "quanto manca", passato compreso (finisce per primo).
    .sort((a, b) => a.day - b.day || a.slot - b.slot);

  async function cancelBooking(b: MyBooking) {
    try {
      await onClear(b.day, b.slot, b.mid);
      setToast(t.slotDeleted);
      setToastUndo(() => () => { onBook(b.day, b.slot, b.mid, roomNumber).catch((e) => setToast(errMsg(e, lang))); });
    }
    catch (e) { setToast(errMsg(e, lang)); setToastUndo(null); }
  }

  // Mostriamo lavatrici e asciugatrici in due gruppi separati (A/B/C ciascuno):
  // la lavatrice è prenotabile; l'asciugatrice è in sola lettura (auto-riservata
  // dal backend col turno successivo) e mostra occupante attuale e precedente.
  const washers = machines.filter((m) => m.type === "washer");
  const dryers  = machines.filter((m) => m.type === "dryer");

  return (
    <div className="flex flex-col pb-6 md:pt-8 md:max-w-3xl md:mx-auto md:w-full">
      {toast     && <Toast msg={toast} onClose={()=>{setToast(null); setToastUndo(null);}} undo={toastUndo ? { label: t.cancel, onUndo: toastUndo } : undefined}/>}
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

        {/* Subito sotto il titolo della sezione, non piu' in fondo alla
            griglia: si legge PRIMA di guardare le card, non dopo. */}
        <p className="text-[11px] mb-2" style={{ color:sub }}>{t.machinesInfo}</p>

        {/* Macchine raggruppate per lettera: una card per gruppo (A, B, C),
            lavatrice e asciugatrice impilate dentro, tre gruppi affiancati.
            Testo e icone piu' grandi di prima, e "chi l'aveva prima" sta
            accanto allo stato sulla stessa riga invece che sotto. */}
        <div className="grid grid-cols-3 gap-2">
          {machinesFor(roomNumber).washers.map((id) => id[2]).map((L) => {
            const wm = washers.find((m) => m.label === L);
            const dm = dryers.find((m) => m.label === L);
            return (
              <SchedaGruppoMacchine key={L} lettera={L} washer={wm} dryer={dm} lang={lang}/>
            );
          })}
        </div>
      </section>

      <div className="mx-5 mb-4 border-t" style={{ borderColor:div }}/>


      {/* Le tue prenotazioni */}
      {roomNumber && (
        <section className="px-5 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[11px] font-mono tracking-widest uppercase flex-1 min-w-0" style={{ color:sub }}>{t.yourBookings}</p>
            {/* Il numero da solo ("2", o peggio "-1") non diceva di cosa: due
                cosa, uno in meno o in piu' di cosa? Il testo esplicito lo
                dice sempre, anche sopra quota — "1 in piu'" e non un "-1"
                che si legge come un errore di calcolo. */}
            <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full tabular-nums"
              title={senzaQuota ? t.noQuota : t.remainingMsg(remaining)}
              style={{
                background: senzaQuota || remaining > 0 ? `color-mix(in srgb, ${GREEN} 15%, transparent)`
                          : remaining === 0 ? "var(--secondary)"
                          : `color-mix(in srgb, var(--destructive) 15%, transparent)`,
                color: senzaQuota || remaining > 0 ? GREEN_T : remaining === 0 ? sub : OOS_T,
              }}>
              {senzaQuota ? t.noQuota : t.remainingChip(remaining)}
            </span>
          </div>
          <div className="rounded-2xl overflow-hidden border" style={{ background:surf, borderColor:div }}>
            {displayBookings.length === 0 ? (
              /* "Nessuna prenotazione attiva" era un vicolo cieco: constatava
                 il vuoto e non diceva come uscirne. La riga sotto lo dice, e
                 porta dove i turni si vedono tutti insieme. */
              <div className="px-4 py-3">
                <p className="text-xs" style={{ color:sub }}>{t.noActiveBookings}</p>
              </div>
            ) : (
              displayBookings.map((b, i) => {
                const cur  = isCurrentBooking(b);
                const past = isPastBooking(b);
                const s    = TIME_SLOTS[b.slot];
                return (
                  /* Il turno in corso era rosso pieno sull'icona, con la riga
                     tinta dietro e un pallino che pulsava: tre segnali d'allarme
                     per una cosa che non e' un allarme — e' solo il tuo bucato
                     che sta girando. Resta la parola "In corso ora" e un
                     pallino fermo; il colore accompagna, non grida. */
                  <div key={`${b.day}-${b.slot}-${b.mid}`} className="flex items-center gap-3 px-4 py-3"
                    style={{ borderBottom: i < displayBookings.length - 1 ? `1px solid ${div}` : "none",
                             background: cur ? `color-mix(in srgb, var(--primary) 4%, transparent)` : "transparent",
                             opacity: past ? 0.6 : 1 }}>
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
                        {cur ? t.inProgressNow : past
                          ? `${t.days[b.day]} ${DAYS_DATE[b.day]} ${monShort(b.day, t.mesiBrevi)} · ${t.favPast}`
                          : `${t.days[b.day]} ${DAYS_DATE[b.day]} ${monShort(b.day, t.mesiBrevi)}`}
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

            {/* Sempre visibile, anche sopra quota: la quota e' per camera,
                ma il server non la applica (vedi commento su `senzaQuota`
                piu' sopra) — e' un'indicazione, non un blocco. Nasconderla
                qui impediva dal client una cosa che dal server passava lo
                stesso, tipo prenotare per un coinquilino o due turni nello
                stesso giorno. La pastiglia rossa qui sopra ha gia' detto che
                si e' sopra quota: il pulsante non ha bisogno di ripeterlo. */}
            <button onClick={onGoDay}
              className="w-full flex items-center justify-center gap-2 py-3 border-t transition-colors"
              style={{
                borderColor:div,
                background:`color-mix(in srgb, ${GREEN} 10%, transparent)`,
                color:GREEN_T,
              }}>
              <Plus size={14}/>
              <span className="text-sm font-bold">
                {activeBookings.length === 0 ? t.bookSlot : t.bookAnother}
              </span>
            </button>
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

          {/* FUORI dalla scheda, e con il bordo tratteggiato: non sono
              prenotazioni, sono turni segnati che potresti prendere.

              Tutti quelli salvati, non solo i liberi: chi ne aveva uno pieno
              o passato prima non lo vedeva piu' da nessuna parte in
              dashboard, e sembrava sparito. Qui resta, muto, finche' non
              torna libero o finche' non lo si toglie da "+ Aggiungi
              preferito". */}
          {favs.length === 0 ? (
            <p className="px-1 text-xs" style={{ color:sub }}>{t.noFavs}</p>
          ) : preferitiConStato.map((f) => {
            const sl = TIME_SLOTS[f.slot];
            const libero = !f.passato && f.mid !== null;
            return (
              <div key={`fav-${f.day}-${f.slot}`}
                className="flex items-center gap-3 px-4 py-2.5 mt-2 rounded-2xl"
                style={ libero
                  ? { border:`1px dashed color-mix(in srgb, ${GREEN} 50%, transparent)`,
                      background:`color-mix(in srgb, ${GREEN} 4%, transparent)` }
                  : { border:`1px dashed ${div}`, background:"transparent" } }>
                <Star size={15} className="shrink-0" style={{ color: libero ? ORANGE : sub, fill: libero ? ORANGE : "none" }}/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: libero ? fg : sub }}>
                    {t.days[f.day]} {DAYS_DATE[f.day]} · {sl.start}–{sl.end}
                  </p>
                  <p className="text-[11px]" style={{ color: libero ? sub : "color-mix(in srgb, var(--foreground) 40%, transparent)" }}>
                    {f.passato ? t.favPast : libero ? t.favAvailable : t.favFull}
                  </p>
                </div>
                {libero && (
                  <button onClick={()=>setQuickTarget({ day:f.day, slot:f.slot })}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-all active:scale-95 shrink-0"
                    style={{ background:`color-mix(in srgb, ${GREEN} 16%, transparent)`, color:GREEN_T }}>
                    <Plus size={12}/>{t.book}
                  </button>
                )}
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

export function TortaTurno({ restaFrazione, colore, size = 15 }: {
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

// Una card per gruppo (A, B, C): lavatrice e asciugatrice impilate dentro,
// con la stessa informazione che avevano le righe — stato, chi la usa, chi
// l'aveva prima, il triangolo se e' guasta — solo compressa perche' tre card
// affiancate raccontano l'intero gruppo senza dover scorrere.
// Una card per gruppo (A, B, C), lavatrice e asciugatrice come due righe
// dentro — a tutta larghezza, non tre card strette affiancate: qui il testo
// puo' stare a dimensione normale invece che a 8-9px, e "chi l'aveva prima"
// sta in fondo alla riga, accanto allo stato, non impilato sotto.
export function SchedaGruppoMacchine({ lettera, washer, dryer, lang }: {
  lettera: string; washer?: Machine; dryer?: Machine; lang: Lang;
}) {
  return (
    <div className="rounded-2xl border flex flex-col items-center gap-3 px-2 py-3.5 min-w-0"
      style={{ background:"var(--card)", borderColor:"var(--border)" }}>
      <p className="text-sm font-mono font-bold" style={{ color:"var(--foreground)" }}>{lettera}</p>
      {washer && <TesseraMacchina machine={washer} lang={lang}/>}
      {dryer  && <TesseraMacchina machine={dryer}  lang={lang}/>}
    </div>
  );
}

export function TesseraMacchina({ machine, lang }: { machine: Machine; lang: Lang }) {
  const t = T[lang];
  const isFree = machine.status === "available";
  const isOOO  = machine.status === "out-of-order";

  // Stessa logica di prima: fuori servizio e occupata sono due fatti
  // indipendenti, e si dicono entrambi.
  const statusText = isOOO
    ? (machine.room ? machine.room : t.oos)
    : isFree ? t.free : machine.room;
  const statusColor = isFree ? GREEN_T : isOOO ? OOS_T : "var(--foreground)";
  // Lo stato si legge dal colore dell'icona stessa — non da un pallino a
  // parte accanto. Solo il guasto ha bisogno di dire di piu' di un colore:
  // "rosso" da solo si confonde con "occupata" (che e' rosso anch'essa, per
  // via della camera), quindi li' resta il triangolo con l'esclamativo.
  const iconColor = isOOO ? OOS_T : isFree ? GREEN_T : YELLOW_T;
  const Icona = machine.type === "washer" ? WashingMachine : Wind;

  const nome = machine.type === "washer" ? t.washerLabel : t.dryerLabel;
  const etichetta = `${nome} ${machine.label} — ${statusText === machine.room ? `${t.room} ${machine.room}` : statusText}`
    + (machine.prevRoom ? `. ${t.lgPrev}: ${machine.prevRoom}` : "");

  // Niente pallino per piano qui: nella Dashboard sono al massimo tre gruppi
  // per lavatrice/asciugatrice, ma sommando tutti e sei i colori possibili
  // (Manica + quattro piani + basso fabbricato) diventava un'accozzaglia —
  // il colore aiuta quando raggruppa tante camere in un elenco (i calendari,
  // il pannello Bici), non quando ne mostra due o tre isolate.
  return (
    <div className="flex flex-col items-center gap-1.5 w-full" aria-label={etichetta}>
      <div className="relative" aria-hidden="true">
        <Icona size={28} style={{ color:iconColor }}/>
        {isOOO && (
          <AlertTriangle size={13} className="absolute -top-1.5 -right-2.5" style={{ color:OOS_T }}/>
        )}
      </div>
      {/* Stato e "chi l'aveva prima" sulla stessa riga: si scrivono da soli
          fianco a fianco quando ci stanno (sono corti — un numero di camera,
          "Libera"), e vanno a capo solo se proprio non entrano — mai uno
          sopra l'altro come prima. */}
      <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5" aria-hidden="true">
        <p className="text-sm font-bold leading-tight" style={{ color:statusColor }}>
          {statusText}
        </p>
        {machine.prevRoom && (
          <span className="flex items-center gap-0.5">
            <History size={11} className="shrink-0" style={{ color:ORANGE_T }}/>
            <span className="text-xs font-mono font-bold" style={{ color:ORANGE_T }}>{machine.prevRoom}</span>
          </span>
        )}
      </div>
    </div>
  );
}
