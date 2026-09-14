import { X, Download, Printer } from "lucide-react";
import { TIME_SLOTS, DAYS_DATE, monShort, type WeekData } from "../../modello";
import { T, type Lang } from "../../i18n";
import { RED, RED_FG } from "../../tema";

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

export function FoglioSettimana({ lang, week, onClose }: {
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
    const blob = new Blob(["﻿" + testo], { type: "text/csv;charset=utf-8" });
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
