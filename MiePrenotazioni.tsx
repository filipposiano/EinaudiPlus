// MiePrenotazioni.tsx — lavanderia e sale nello stesso elenco.
//
// Le prenotazioni della camera stavano in due posti che non si parlavano: i
// turni di lavatrice in fondo alla dashboard, le fasce di cinema e musica
// dentro la sala che le aveva prese. Per sapere "che cosa ho prenotato questa
// settimana" bisognava aprire tre schermate e tenerle a mente.
//
// Qui c'è una lista sola, in ordine di tempo, con due schede: quello che deve
// ancora succedere, e quello che è già successo. Ogni lavaggio si porta dietro
// la sua asciugatrice — che non è una seconda prenotazione, è la coda della
// prima, e si legge come tale.

import { useState, useEffect, useCallback } from "react";
import { Trash2, Loader2, Film, Music } from "lucide-react";
import * as roomsApi from "./roomsApi";
import type { RoomKind, RoomBooking } from "./roomsApi";
import * as api from "./api";
import { T, errMsg } from "./i18n";
import type { Lang } from "./i18n";
import {
  TIME_SLOTS, DAYS_DATE, TODAY_DOW, WEEKLY_QUOTA,
  myWeekBookings, isPastBooking, isCurrentBooking, nextRef, monShort,
} from "./modello";
import type { WeekData } from "./modello";
import { WashingMachine } from "./icone";

const fg   = "var(--foreground)";
const sub  = "var(--gray-accessible-text)";
const surf = "var(--card)";
const div  = "var(--border)";
const RED  = "var(--primary)";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtMin = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/**
 * Una riga dell'elenco, da qualunque parte venga.
 *
 * `ord` è la chiave con cui si mette in fila roba di natura diversa: giorno ×
 * 10000 + minuti dall'inizio. Un turno di lavatrice e una serata al cinema non
 * hanno niente in comune tranne quando cominciano, ed è l'unica cosa che serve
 * per ordinarli.
 */
interface Riga {
  chiave: string;
  ord: number;
  giorno: number;
  quando: string;
  titolo: string;
  /** La coda: l'asciugatrice di un lavaggio, o il tipo di serata di una sala. */
  seguito?: string;
  tipo: "lavanderia" | "cinema" | "music";
  passata: boolean;
  inCorso: boolean;
  /** Come cancellarla. Assente se non si può (una passata, o una altrui). */
  elimina?: () => Promise<void>;
}

export default function MiePrenotazioni({ lang, week, roomNumber, onClear, onVaiAllaSettimana }: {
  lang: Lang;
  week: WeekData;
  roomNumber: string | null;
  onClear: (day: number, slot: number, machine: string) => Promise<void>;
  onVaiAllaSettimana: () => void;
}) {
  const t = T[lang];
  const mio = (roomNumber || "").trim();

  const [scheda, setScheda]   = useState<"attive" | "storico">("attive");
  const [sale, setSale]       = useState<RoomBooking[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg]         = useState<string | null>(null);
  const [busy, setBusy]       = useState<string | null>(null);

  // Le fasce delle sale prenotate da questa camera. Le due sale si chiedono in
  // parallelo, e una che non risponde non ferma l'altra: l'elenco è comunque
  // più utile a metà che non del tutto.
  const caricaSale = useCallback(async () => {
    if (!mio) { setSale([]); setLoading(false); return; }
    const una = async (id: RoomKind) => {
      try { return (await roomsApi.getRoomBookings(id)).map((b) => ({ ...b, _sala: id })); }
      catch { return []; }
    };
    const [c, m] = await Promise.all([una("cinema"), una("music")]);
    setSale([...c, ...m] as RoomBooking[]);
    setLoading(false);
  }, [mio]);

  useEffect(() => { void caricaSale(); }, [caricaSale]);

  if (!mio) {
    return (
      <div className="px-5 pt-10 text-center">
        <p className="text-sm" style={{ color:sub }}>{t.servelaCamera}</p>
      </div>
    );
  }

  // ── Lavanderia ──────────────────────────────────────────────────────────
  const turni = myWeekBookings(week, mio);
  const righeLavanderia: Riga[] = turni.map((b) => {
    const s   = TIME_SLOTS[b.slot];
    const rif = nextRef(b.day, b.slot);
    const sa  = TIME_SLOTS[rif.slot];
    const passata = isPastBooking(b);
    return {
      chiave: `w-${b.day}-${b.slot}-${b.mid}`,
      ord: b.day * 10000 + b.slot,
      giorno: b.day,
      quando: `${s.start} – ${s.end}`,
      titolo: `${t.washer} ${b.mid[2]}`,
      seguito: `${t.dryer} ${b.mid[2]} · ${sa.start} – ${sa.end}`,
      tipo: "lavanderia",
      passata,
      inCorso: isCurrentBooking(b),
      elimina: passata ? undefined : async () => { await onClear(b.day, b.slot, b.mid); },
    };
  });

  // ── Sale ────────────────────────────────────────────────────────────────
  //
  // `name` è il numero di camera di chi ha prenotato: è così che le sale
  // riconoscono l'intestatario (non c'è un login, come in lavanderia).
  //
  // Le due metà di una serata che scavalca la mezzanotte hanno lo stesso
  // `group`: si tiene solo la prima, altrimenti la stessa serata comparirebbe
  // due volte, una delle quali alle 00:00 del giorno dopo.
  const visti = new Set<string>();
  const righeSale: Riga[] = (sale ?? [])
    .filter((b) => b.name === mio)
    .sort((a, b) => a.day - b.day || a.start - b.start)
    .filter((b) => {
      if (!b.group) return true;
      if (visti.has(b.group)) return false;
      visti.add(b.group);
      return true;
    })
    .map((b) => {
      const sala: RoomKind = (b as any)._sala === "music" ? "music" : "cinema";
      const oraOra = new Date().getHours() * 60 + new Date().getMinutes();
      const fine = b.end <= b.start ? b.end + 24 * 60 : b.end;
      const passata = b.day < TODAY_DOW || (b.day === TODAY_DOW && fine <= oraOra);
      const inCorso = b.day === TODAY_DOW && b.start <= oraOra && oraOra < fine;
      return {
        chiave: `r-${sala}-${b.id}`,
        ord: b.day * 10000 + b.start / 75,
        giorno: b.day,
        quando: `${fmtMin(b.start)} – ${fmtMin(b.end)}`,
        titolo: sala === "cinema" ? t.navCinema : t.navMusica,
        seguito: b.type === "open" ? t.serataAperta : b.type === "private" ? t.serataPrivata : undefined,
        tipo: sala,
        passata,
        inCorso,
        elimina: passata ? undefined : async () => {
          const restanti = await roomsApi.clearRoomBooking(sala, b.id);
          setSale((prec) => [
            ...(prec ?? []).filter((x) => (x as any)._sala !== sala),
            ...restanti.map((x) => ({ ...x, _sala: sala })),
          ] as RoomBooking[]);
        },
      };
    });

  const tutte = [...righeLavanderia, ...righeSale].sort((a, b) => a.ord - b.ord);
  const attive  = tutte.filter((r) => !r.passata);
  const storico = tutte.filter((r) => r.passata).reverse();
  const elenco  = scheda === "attive" ? attive : storico;

  const senzaQuota = mio === api.DIREZIONE;
  const rimaste    = WEEKLY_QUOTA - turni.length;

  async function cancella(r: Riga) {
    if (!r.elimina) return;
    setBusy(r.chiave);
    try { await r.elimina(); setMsg(t.slotDeleted); }
    catch (e) { setMsg(errMsg(e, lang)); }
    finally { setBusy(null); }
  }

  const Icona = (r: Riga) => (r.tipo === "cinema" ? Film : r.tipo === "music" ? Music : WashingMachine);

  return (
    <div className="flex flex-col pb-6 md:pt-8 md:max-w-3xl md:mx-auto md:w-full">
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-2xl font-bold font-display" style={{ color:fg }}>{t.yourBookings}</h2>
        <p className="text-xs mt-1" style={{ color:sub }}>{t.room} {mio}</p>
      </div>

      {/* Due schede, non un filtro a tendina: sono due, e una delle due è
          quella che si guarda sempre. */}
      <div className="px-5 mb-3">
        <div className="flex gap-1 p-1 rounded-full w-fit" style={{ background:"var(--secondary)" }}>
          {(["attive", "storico"] as const).map((k) => (
            <button key={k} onClick={()=>setScheda(k)}
              className="px-4 py-1.5 rounded-full text-xs font-bold transition-colors"
              style={ scheda === k
                ? { background:RED, color:"var(--primary-foreground)" }
                : { background:"transparent", color:sub } }>
              {k === "attive" ? t.attive : t.storico}
            </button>
          ))}
        </div>
      </div>

      {msg && <p className="px-5 mb-2 text-xs" style={{ color:sub }}>{msg}</p>}

      {loading && (
        <div className="flex items-center justify-center py-10" style={{ color:sub }}>
          <Loader2 size={18} className="animate-spin"/>
        </div>
      )}

      <div className="px-5 flex flex-col gap-2">
        {!loading && elenco.length === 0 && (
          <div className="rounded-2xl border px-4 py-4" style={{ background:surf, borderColor:div }}>
            <p className="text-xs" style={{ color:sub }}>
              {scheda === "attive" ? t.noActiveBookings : t.storicoVuoto}
            </p>
          </div>
        )}

        {elenco.map((r) => {
          const I = Icona(r);
          return (
            <div key={r.chiave} className="flex items-center gap-3 rounded-2xl border px-4 py-3"
              style={{
                background: r.passata ? "transparent" : surf,
                borderColor: div,
                borderStyle: r.passata ? "dashed" : "solid",
                opacity: r.passata ? 0.75 : 1,
              }}>
              <div className="p-2 rounded-xl shrink-0"
                style={ r.inCorso
                  ? { background:`color-mix(in srgb, var(--primary) 12%, transparent)`, color:RED }
                  : { background:"var(--secondary)", color:sub } }>
                <I size={15}/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color:fg }}>
                  {r.titolo} · <span className="font-mono">{r.quando}</span>
                </p>
                <p className="text-[11px] font-mono truncate" style={{ color: r.inCorso ? RED : sub }}>
                  {r.inCorso ? t.inProgressNow : `${t.days[r.giorno]} ${DAYS_DATE[r.giorno]} ${monShort(r.giorno, t.mesiBrevi)}`}
                  {r.seguito ? ` · ${r.seguito}` : ""}
                </p>
              </div>
              {r.elimina && (
                <button onClick={()=>cancella(r)} aria-label={t.delete} disabled={busy === r.chiave}
                  className="p-2 rounded-lg shrink-0 transition-all active:scale-90"
                  style={{ background:"var(--secondary)", color:sub, opacity: busy === r.chiave ? 0.5 : 1 }}>
                  {busy === r.chiave ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14}/>}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* La quota, detta per esteso una volta sola e in fondo: è una nota a
          piè di pagina sull'elenco che si è appena letto, non un cartello. */}
      <p className="px-5 mt-4 text-[11px] leading-relaxed" style={{ color:sub }}>
        {senzaQuota ? t.noQuota : t.remainingMsg(Math.max(0, rimaste))}
      </p>

      {(senzaQuota || rimaste > 0) && (
        <div className="px-5 mt-3">
          <button onClick={onVaiAllaSettimana}
            className="w-full py-3 rounded-2xl text-sm font-bold transition-all active:scale-[0.98]"
            style={{ background:`color-mix(in srgb, var(--primary) 12%, transparent)`, color:RED }}>
            {t.bookSlot}
          </button>
        </div>
      )}
    </div>
  );
}
