import { useState } from "react";
import { Wind, Send, AlertTriangle, Wrench } from "lucide-react";
import { WashingMachine } from "../../icons";
import { Toast } from "../../pannelli";
import { machinesFor, type Machine, type MachineType, type StatusData } from "../../modello";
import { T, errMsg, type Lang } from "../../i18n";
import { RED, RED_FG, OOS_C, OOS_T, GREEN, GREEN_T, type Theme } from "../../tema";

// ─── Segnala un guasto ─────────────────────────────────────────────────────────

export function SegnalaGuastoSheet({ lang, status, onStatus, roomNumber }: {
  theme?: Theme; lang: Lang; status: StatusData; roomNumber: string | null;
  onStatus: (machine:string, oos:boolean, nota?:string)=>Promise<void>;
}) {
  const t = T[lang];
  const [toast, setToast] = useState<string | null>(null);
  // La macchina per cui si sta scrivendo la nota, se si sta scrivendo.
  const [nota, setNota] = useState<{ m: Machine; testo: string } | null>(null);
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
      <>
        {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
        <div className="pb-8">
          <div className="px-6 pt-4 pb-4">
            <div className="flex items-center gap-2.5 min-w-0 mb-1">
              <div className="p-2 rounded-xl shrink-0"
                style={{ background:`color-mix(in srgb, var(--destructive) 12%, transparent)`, color:OOS_T }}>
                {nota.m.type === "washer" ? <WashingMachine size={18}/> : <Wind size={17}/>}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-mono tracking-widest uppercase" style={{ color:sub }}>{t.reportOos}</p>
                <p className="text-lg font-bold truncate" style={{ color:fg }}>{etichetta}</p>
              </div>
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
      </>
    );
  }

  // Pagina come "Lavanderia": si raggiunge dal menu e si lascia allo stesso
  // modo — riaprendo il menu. Nessuna X in alto: era il residuo di quando
  // questo era un foglio sopra l'app, e su una pagina prometteva una chiusura
  // che qui non vuol dire niente.
  return (
    <>
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
      <div className="pb-8">
        <div className="px-6 pt-4 pb-4">
          <div>
            <p className="text-[11px] font-mono tracking-widest uppercase mb-0.5" style={{ color:sub }}>{t.machineMgmt}</p>
            <p className="text-lg font-bold" style={{ color:fg }}>{t.oos}</p>
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
    </>
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
