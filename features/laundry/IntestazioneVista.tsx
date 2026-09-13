import { ChevronLeft } from "lucide-react";
import { T, type Lang } from "../../i18n";
import { RED, RED_FG } from "../../tema";

// ─── Torna alla dashboard + Giornaliero/Settimana ──────────────────────────────
//
// La barra in fondo (Dashboard/Giornaliero/Settimana) e' sparita: le sue tre
// destinazioni valevano solo dentro la lavanderia, e riservarle un banner
// fisso in ogni schermata sembrava importante solo perche' c'era. Le due
// schermate che restano — questa e la settimanale — ora si scambiano fra
// loro con un interruttore qui in cima, e tornano alla dashboard con lo
// stesso pulsante: due gesti, non tre destinazioni sempre in vista.
export function IntestazioneVista({ lang, screen, onScreen, titolo, azione }: {
  lang: Lang; screen: 1 | 2; onScreen: (i: number) => void;
  titolo: string; azione?: React.ReactNode;
}) {
  const t   = T[lang];
  const sub = "var(--gray-accessible-text)";

  return (
    <div className="px-5 pt-3 pb-2 shrink-0">
      <div className="flex items-center justify-between gap-3 mb-2">
        <button onClick={()=>onScreen(0)}
          className="flex items-center gap-1 -ml-1.5 px-1.5 py-1 rounded-lg text-xs font-semibold transition-colors"
          style={{ color:sub }}>
          <ChevronLeft size={15} className="shrink-0"/>{t.backToDashboard}
        </button>
        {azione}
      </div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold" style={{ color:"var(--foreground)" }}>{titolo}</h2>
        <div className="flex items-center gap-0.5 p-0.5 rounded-xl shrink-0" style={{ background:"var(--secondary)" }}>
          {([[1, t.daily], [2, t.weekly]] as [1 | 2, string][]).map(([i, label]) => (
            <button key={i} onClick={()=>onScreen(i)}
              className="px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-colors"
              style={screen===i ? { background:RED, color:RED_FG } : { color:sub }}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
