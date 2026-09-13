import { useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import * as api from "../../api";
import { T, type Lang } from "../../i18n";
import { RED, RED_FG, GREEN_T, OOS_T } from "../../tema";

// ─── Feedback ──────────────────────────────────────────────────────────────────

export function FeedbackModal({ lang, room, onClose }: { lang: Lang; room: string | null; onClose: ()=>void }) {
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

  // Pagina come "Lavanderia", non piu' un foglio dal basso: si raggiunge dal
  // menu e si lascia allo stesso modo.
  return (
    <div className="pt-4 pb-7 px-6">
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
  );
}
