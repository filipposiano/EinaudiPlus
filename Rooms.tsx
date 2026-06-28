// Rooms.tsx — Sale a FASCE ORARIE LIBERE (Cinema e Musica).
//
// Come gestiamo le fasce libere:
//  • il tempo è in MINUTI dalla mezzanotte; ogni prenotazione è un blocco [start,end);
//  • una TIMELINE giornaliera mostra a colpo d'occhio i blocchi occupati nella finestra
//    oraria della sala (Cinema 0–24, Musica 9–23);
//  • due SELETTORI "Inizio/Fine" (step 30') generano il blocco; un controllo di
//    sovrapposizione (client + server) impedisce i conflitti;
//  • il backend (Apps Script su Google Sheet) resetta tutto ogni lunedì notte.

import { useState, useEffect, useCallback } from "react";
import {
  Film, Music, X, Plus, Trash2, Info, Loader2, AlertTriangle,
} from "lucide-react";
import * as roomsApi from "./roomsApi";
import type { RoomKind, RoomBooking, CinemaType } from "./roomsApi";

type Lang = "it" | "en";

const RED = "var(--primary)", RED_FG = "var(--primary-foreground)";
const OOS = "var(--destructive)";
const fg = "var(--foreground)", sub = "var(--muted-foreground)";
const surf = "var(--card)", div = "var(--border)", chip = "var(--secondary)";

// ─── Helpers tempo ──────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
const fmtMin = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const TODAY = (new Date().getDay() + 6) % 7; // 0 = Lunedì

// Finestra oraria e tipo per ciascuna sala
const ROOM_CFG: Record<RoomKind, { winStart: number; winEnd: number; step: number }> = {
  cinema: { winStart: 0,       winEnd: 24 * 60, step: 30 },
  music:  { winStart: 9 * 60,  winEnd: 23 * 60, step: 30 },
};

function timeOptions(winStart: number, winEnd: number, step: number) {
  const out: number[] = [];
  for (let m = winStart; m <= winEnd; m += step) out.push(m);
  return out;
}

// ─── i18n ─────────────────────────────────────────────────────────────────────
const T = {
  it: {
    cinema: "Sala Cinema", music: "Sala Musica",
    days: ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"],
    daysLong: ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"],
    rules: "Regole", close: "Chiudi",
    free: "Libera tutto il giorno", occupied: "Occupata",
    newBooking: "Nuova prenotazione",
    start: "Inizio", end: "Fine", name: "Nome", yourName: "Il tuo nome",
    type: "Tipo di proiezione", priv: "Privata", open: "Aperta a tutti (es. partite)",
    book: "Prenota blocco", cancel: "Annulla",
    bookings: "Prenotazioni del giorno", none: "Nessuna prenotazione",
    needName: "Inserisci un nome", badRange: "L'orario di fine deve essere dopo l'inizio",
    overlap: "Si sovrappone a una prenotazione esistente", booked: "Prenotato ✓",
    full: "Giorno pieno: massimo 6 prenotazioni.",
    deleted: "Prenotazione eliminata", errorGeneric: "Errore, riprova.",
    loading: "Carico…", retry: "Riprova", netError: "Impossibile contattare il foglio.",
    mockNote: "Modalità demo: i dati non sono ancora salvati sul foglio Google.",
    rulesTitle: "Regolamento", tipsTitle: "Problemi di connessione",
    musicNote: "Strumenti non in cuffia: consentiti solo 16:00–20:00.",
  },
  en: {
    cinema: "Cinema Room", music: "Music Room",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    daysLong: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    rules: "Rules", close: "Close",
    free: "Free all day", occupied: "Booked",
    newBooking: "New booking",
    start: "Start", end: "End", name: "Name", yourName: "Your name",
    type: "Screening type", priv: "Private", open: "Open to all (e.g. matches)",
    book: "Book block", cancel: "Cancel",
    bookings: "Bookings for the day", none: "No bookings",
    needName: "Enter a name", badRange: "End time must be after start",
    overlap: "Overlaps an existing booking", booked: "Booked ✓",
    full: "Day is full: max 6 bookings.",
    deleted: "Booking deleted", errorGeneric: "Error, try again.",
    loading: "Loading…", retry: "Retry", netError: "Couldn't reach the sheet.",
    mockNote: "Demo mode: data is not yet saved to the Google sheet.",
    rulesTitle: "Rules", tipsTitle: "Connection tips",
    musicNote: "Instruments without headphones: allowed only 16:00–20:00.",
  },
} as const;

// ─── Testi regolamenti ──────────────────────────────────────────────────────
const RULES: Record<RoomKind, Record<Lang, { rules: string[]; tips?: string[] }>> = {
  cinema: {
    it: {
      rules: [
        "La sala può essere prenotata in ogni momento.",
        "La sala è dotata di un proiettore (cavo HDMI già presente) e un impianto audio (collegabile via Bluetooth). Ricordatevi di portare il vostro PC.",
        "Chi prenota è responsabile di eventuali danni e della pulizia della sala.",
        "Per prenotare indicate l'orario in cui pensate di usarla, il vostro nome e se si tratta di uso personale o di una proiezione aperta a tutti (es. partite).",
        "Le prenotazioni si resettano ogni lunedì notte.",
      ],
      tips: [
        "Per connettere il PC al proiettore: accendete il proiettore con il telecomando, selezionate \"Source\" e scegliete HDMI 2 (dovrebbe connettersi automaticamente).",
        "Per connettere il PC all'impianto audio: attivate il bluetooth sul PC, accendete la soundbar, cliccate sul tasto del telecomando con il simbolo del Bluetooth (*). Sullo schermo della soundbar comparirà \"BT PAIRING\", a quel punto cercate la soundbar tra i dispositivi sul PC.",
      ],
    },
    en: {
      rules: [
        "You can reserve it when you want.",
        "In the TV room there is a projector (HDMI cable provided) and an audio system (Bluetooth connection). Remember to bring your PC.",
        "Whoever reserves the room is responsible for any damages and the cleaning of the room.",
        "To reserve, state the time, your name, and if it's for personal use or an open projection.",
        "The schedule resets every Monday night.",
      ],
      tips: [
        "To connect the PC to the projector: turn the projector on with the remote, select \"Source\" and choose HDMI 2 (it should connect automatically).",
        "To connect the PC to the audio system: enable Bluetooth on the PC, turn on the soundbar, press the remote button with the Bluetooth symbol (*). The soundbar shows \"BT PAIRING\", then look for the soundbar among the PC's devices.",
      ],
    },
  },
  music: {
    it: {
      rules: [
        "Potete prenotarla quando volete.",
        "Si può utilizzare dalle 9:00 alle 23:00 (ATTENZIONE: l'uso di strumenti NON in cuffia è consentito SOLO dalle 16:00 alle 20:00).",
        "Chi prenota è responsabile di eventuali danni e della pulizia della sala.",
        "Le prenotazioni si resettano ogni lunedì notte.",
      ],
    },
    en: {
      rules: [
        "You can reserve it whenever you want.",
        "It can be used from 9:00 to 23:00 (NOTE: using instruments NOT with headphones is allowed ONLY from 16:00 to 20:00).",
        "Whoever reserves the room is responsible for any damages and the cleaning of the room.",
        "The schedule resets every Monday night.",
      ],
    },
  },
};

// ─── Rules modal ──────────────────────────────────────────────────────────────
function RulesModal({ room, lang, onClose }: { room: RoomKind; lang: Lang; onClose: () => void }) {
  const t = T[lang];
  const r = RULES[room][lang];
  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background: "rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pb-8 max-h-[85%] overflow-y-auto" style={{ background: "var(--background)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 sticky top-0" style={{ background: "var(--background)" }}>
          <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }} />
          <div className="flex items-center justify-between">
            <p className="text-lg font-bold" style={{ color: fg }}>{room === "cinema" ? t.cinema : t.music} · {t.rulesTitle}</p>
            <button onClick={onClose} className="p-2 rounded-xl" style={{ color: sub, background: chip }}><X size={16} /></button>
          </div>
        </div>
        <div className="px-6">
          <ol className="flex flex-col gap-2.5">
            {r.rules.map((line, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 size-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono"
                  style={{ background: `color-mix(in srgb, var(--primary) 15%, transparent)`, color: RED }}>{i + 1}</span>
                <p className="text-sm leading-relaxed" style={{ color: fg }}>{line}</p>
              </li>
            ))}
          </ol>
          {r.tips && (
            <>
              <p className="text-[11px] font-mono tracking-widest uppercase mt-6 mb-2" style={{ color: sub }}>{t.tipsTitle}</p>
              <div className="flex flex-col gap-2.5">
                {r.tips.map((line, i) => (
                  <div key={i} className="flex gap-3 rounded-2xl p-3 border" style={{ background: surf, borderColor: div }}>
                    <Info size={15} className="shrink-0 mt-0.5" style={{ color: RED }} />
                    <p className="text-xs leading-relaxed" style={{ color: sub }}>{line}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Timeline giornaliera ──────────────────────────────────────────────────────
function Timeline({ room, bookings }: { room: RoomKind; bookings: RoomBooking[] }) {
  const { winStart, winEnd } = ROOM_CFG[room];
  const span = winEnd - winStart;
  const pct = (m: number) => `${((m - winStart) / span) * 100}%`;
  // tick ogni 3 ore (cinema) o 2 ore (musica)
  const stepH = room === "cinema" ? 3 : 2;
  const ticks: number[] = [];
  for (let m = winStart; m <= winEnd; m += stepH * 60) ticks.push(m);

  return (
    <div className="px-1 pt-1 pb-5">
      <div className="relative h-9 rounded-xl overflow-hidden" style={{ background: chip }}>
        {bookings.map((b) => {
          const open = b.type === "open";
          return (
            <div key={b.id} className="absolute top-0 bottom-0 flex items-center justify-center overflow-hidden"
              title={`${b.name} · ${fmtMin(b.start)}–${fmtMin(b.end)}`}
              style={{
                left: pct(Math.max(b.start, winStart)), width: `${((Math.min(b.end, winEnd) - Math.max(b.start, winStart)) / span) * 100}%`,
                background: open ? `color-mix(in srgb, ${RED} 75%, transparent)` : `color-mix(in srgb, ${OOS} 65%, transparent)`,
                borderLeft: "1px solid var(--background)",
              }}>
              <span className="text-[8px] font-mono truncate px-1" style={{ color: "#fff" }}>{b.name}</span>
            </div>
          );
        })}
      </div>
      <div className="relative h-4 mt-1">
        {ticks.map((m) => (
          <span key={m} className="absolute text-[8px] font-mono -translate-x-1/2" style={{ left: pct(m), color: sub }}>{fmtMin(m)}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Vista sala ────────────────────────────────────────────────────────────────
export default function RoomView({ room, lang }: { room: RoomKind; lang: Lang }) {
  const t = T[lang];
  const cfg = ROOM_CFG[room];
  const opts = timeOptions(cfg.winStart, cfg.winEnd, cfg.step);

  const [bookings, setBookings] = useState<RoomBooking[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [selDay, setSelDay]     = useState(TODAY);
  const [start, setStart]       = useState(room === "music" ? 16 * 60 : 18 * 60);
  const [end, setEnd]           = useState(room === "music" ? 18 * 60 : 20 * 60);
  const [name, setName]         = useState("");
  const [ctype, setCtype]       = useState<CinemaType>("private");
  const [toast, setToast]       = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [busy, setBusy]         = useState(false);

  const refresh = useCallback(async () => {
    try { setBookings(await roomsApi.getRoomBookings(room)); setError(false); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [room]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2500); return () => clearTimeout(id); }, [toast]);

  const dayBookings = bookings.filter((b) => b.day === selDay).sort((a, b) => a.start - b.start);

  async function submit() {
    if (!name.trim()) { setToast(t.needName); return; }
    if (end <= start) { setToast(t.badRange); return; }
    if (roomsApi.hasOverlap(bookings, selDay, start, end)) { setToast(t.overlap); return; }
    setBusy(true);
    try {
      const payload: Omit<RoomBooking, "id"> = room === "cinema"
        ? { day: selDay, start, end, name: name.trim(), type: ctype }
        : { day: selDay, start, end, name: name.trim() };
      setBookings(await roomsApi.bookRoom(room, payload));
      setName(""); setToast(t.booked);
    } catch (e: any) {
      const msg = String(e?.message);
      setToast(msg === "overlap" ? t.overlap : msg === "full" ? t.full : t.errorGeneric);
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    try { setBookings(await roomsApi.clearRoomBooking(room, id)); setToast(t.deleted); }
    catch { setToast(t.errorGeneric); }
  }

  const Icon = room === "cinema" ? Film : Music;

  if (loading) {
    return <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: sub }}>
      <Loader2 size={26} className="animate-spin-slow" style={{ color: RED }} /><p className="text-sm">{t.loading}</p>
    </div>;
  }
  if (error) {
    return <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center" style={{ color: sub }}>
      <AlertTriangle size={26} style={{ color: OOS }} /><p className="text-sm">{t.netError}</p>
      <button onClick={() => { setLoading(true); refresh(); }} className="rounded-xl px-4 py-2 text-sm font-semibold" style={{ background: RED, color: RED_FG }}>{t.retry}</button>
    </div>;
  }

  return (
    <div className="flex flex-col h-full lg:max-w-3xl lg:mx-auto lg:w-full">
      {rulesOpen && <RulesModal room={room} lang={lang} onClose={() => setRulesOpen(false)} />}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-toast-in">
          <div className="rounded-2xl px-4 py-3 shadow-2xl border text-sm font-medium" style={{ background: surf, borderColor: div, color: fg }}>{toast}</div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6">
        {/* Intestazione sala */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl" style={{ background: `color-mix(in srgb, var(--primary) 15%, transparent)`, color: RED }}><Icon size={18} /></div>
            <h2 className="text-base font-bold" style={{ color: fg }}>{room === "cinema" ? t.cinema : t.music}</h2>
          </div>
          <button onClick={() => setRulesOpen(true)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold border transition-all active:scale-95"
            style={{ background: chip, borderColor: div, color: fg }}>
            <Info size={14} />{t.rules}
          </button>
        </div>

        {roomsApi.isMock(room) && (
          <p className="text-[11px] mb-3 rounded-xl px-3 py-2" style={{ background: `color-mix(in srgb, #f59e0b 12%, transparent)`, color: "#f59e0b" }}>{t.mockNote}</p>
        )}

        {/* Selettore giorni */}
        <div className="grid grid-cols-7 gap-1 mb-3">
          {t.days.map((d, i) => {
            const active = i === selDay;
            return (
              <button key={d} onClick={() => setSelDay(i)} className="flex flex-col items-center py-1.5 rounded-xl transition-colors"
                style={{ background: active ? RED : "transparent", color: active ? RED_FG : sub }}>
                <span className="text-[9px] font-mono uppercase">{d}</span>
              </button>
            );
          })}
        </div>

        {/* Timeline occupazione */}
        <Timeline room={room} bookings={dayBookings} />

        {/* Form nuova prenotazione */}
        <div className="rounded-2xl border p-4 mb-4" style={{ background: surf, borderColor: div }}>
          <p className="text-[11px] font-mono tracking-widest uppercase mb-3" style={{ color: sub }}>{t.newBooking}</p>

          <div className="flex gap-3 mb-3">
            <label className="flex-1">
              <span className="text-[11px]" style={{ color: sub }}>{t.start}</span>
              <select value={start} onChange={(e) => setStart(Number(e.target.value))}
                className="w-full mt-1 rounded-xl px-3 py-2.5 text-sm font-mono outline-none"
                style={{ background: chip, color: fg, border: `1px solid ${div}` }}>
                {opts.slice(0, -1).map((m) => <option key={m} value={m}>{fmtMin(m)}</option>)}
              </select>
            </label>
            <label className="flex-1">
              <span className="text-[11px]" style={{ color: sub }}>{t.end}</span>
              <select value={end} onChange={(e) => setEnd(Number(e.target.value))}
                className="w-full mt-1 rounded-xl px-3 py-2.5 text-sm font-mono outline-none"
                style={{ background: chip, color: fg, border: `1px solid ${div}` }}>
                {opts.filter((m) => m > start).map((m) => <option key={m} value={m}>{fmtMin(m)}</option>)}
              </select>
            </label>
          </div>

          <label className="block mb-3">
            <span className="text-[11px]" style={{ color: sub }}>{t.name}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.yourName}
              className="w-full mt-1 rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: chip, color: fg, border: `1px solid ${div}` }} />
          </label>

          {room === "cinema" && (
            <div className="mb-3">
              <span className="text-[11px]" style={{ color: sub }}>{t.type}</span>
              <div className="flex gap-2 mt-1">
                {([["private", t.priv], ["open", t.open]] as [CinemaType, string][]).map(([val, label]) => (
                  <button key={val} onClick={() => setCtype(val)}
                    className="flex-1 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all active:scale-95 border"
                    style={ctype === val
                      ? { background: RED, color: RED_FG, borderColor: RED }
                      : { background: chip, color: fg, borderColor: div }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {room === "music" && <p className="text-[11px] mb-3" style={{ color: "#f59e0b" }}>{t.musicNote}</p>}

          <button onClick={submit} disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
            style={{ background: RED, color: RED_FG, opacity: busy ? 0.6 : 1 }}>
            <Plus size={15} />{t.book} · {fmtMin(start)}–{fmtMin(end)}
          </button>
        </div>

        {/* Prenotazioni del giorno */}
        <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color: sub }}>
          {t.bookings} · {t.daysLong[selDay]}
        </p>
        <div className="rounded-2xl overflow-hidden border" style={{ background: surf, borderColor: div }}>
          {dayBookings.length === 0 ? (
            <div className="px-4 py-4 text-center"><p className="text-xs" style={{ color: sub }}>{t.none}</p></div>
          ) : (
            dayBookings.map((b, i) => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: i < dayBookings.length - 1 ? `1px solid ${div}` : "none" }}>
                <div className="w-px h-8 rounded-full shrink-0" style={{ background: b.type === "open" ? RED : (room === "cinema" ? OOS : RED) }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono font-bold" style={{ color: fg }}>{fmtMin(b.start)} – {fmtMin(b.end)}</p>
                  <p className="text-[11px] truncate" style={{ color: sub }}>
                    {b.name}{b.type ? ` · ${b.type === "open" ? t.open : t.priv}` : ""}
                  </p>
                </div>
                <button onClick={() => remove(b.id)} aria-label={t.cancel}
                  className="p-2 rounded-lg shrink-0 transition-all active:scale-90"
                  style={{ background: `color-mix(in srgb, var(--destructive) 10%, transparent)`, color: OOS }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
