// pannelli.tsx — i fogli che si aprono sopra l'app.
//
// Impostazioni, promemoria (push e Telegram) e il prompt di installazione.
// Sono foglie: non sanno niente di turni, prenotazioni o macchine, e nessuno
// di loro riceve `week` o `status`. Per questo stanno insieme e fuori da
// App.tsx — si possono leggere e cambiare senza sapere come funziona la
// lavanderia.

import { useState, useEffect } from "react";
import {
  X, ChevronRight, Globe, Bell, BellRing, Download, Eye, ShieldCheck,
  Send, Share, Menu,
} from "lucide-react";
import * as api from "./api";
import * as push from "./push";
import { T, LINGUE, type Lang } from "./i18n";
import { RED, RED_FG } from "./tema";
import type { Role as AdminRole } from "./AdminPanel";

/** Come si chiama un ruolo quando lo si mostra a chi ha fatto l'accesso. */
export const etichettaRuolo = (r: AdminRole | null) =>
  r === "sistemista" ? "sistemista" : r === "staff" ? "staff" : "FDO";
// ─── Impostazioni ───────────────────────────────────────────────────────────
//
// Un solo pulsante al posto di quattro-cinque icone sparse nell'header: lingua,
// notifiche, installazione app, accessibilità. Il refresh manuale è sparito del
// tutto (riaprire l'app ricarica già i dati da sola) e così il selettore
// manuale del tema, che ora segue sempre quello del telefono — vedi l'effetto
// che ascolta prefers-color-scheme in cima al componente App.
export function SettingsSheet({ lang, room, adminRole, onLang, onAccessibility, onClose }: {
  lang: Lang; room: string | null;
  adminRole: AdminRole | null;
  onLang: (l: Lang) => void; onAccessibility: () => void; onClose: () => void;
}) {
  // Le lingue non sono più due: al posto dell'interruttore c'è un elenco che
  // si apre. Vive qui e non in un foglio a parte perché è una riga sola che
  // si espande — aprire un altro pannello sopra questo, per scegliere fra sei
  // voci, sarebbe stato un livello di troppo.
  const [lingueAperte, setLingueAperte] = useState(false);
  const linguaCorrente = LINGUE.find((l) => l.id === lang);
  const fg  = "var(--foreground)";
  const sub = "var(--gray-accessible-text)";
  const div = "var(--border)";

  const [reminderState, setReminderState] = useState<push.ReminderState>("unknown");
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Il motivo per cui l'attivazione non e' andata a buon fine, quando a dirlo e'
  // stato il server (oggi: troppi dispositivi sulla stessa camera). Arriva gia'
  // scritto per un residente, e si mostra com'e': tradurlo in sei lingue
  // vorrebbe dire tenere allineate sei stringhe per un caso che si vede una
  // volta ogni mai — e nel frattempo il silenzio sarebbe peggio.
  const [pushErr, setPushErr] = useState<string | null>(null);
  const standalone = typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true);

  useEffect(() => { push.getReminderState().then(setReminderState); }, []);

  async function toggleReminders() {
    if (busy || !room) return;
    setBusy(true);
    setPushErr(null);
    try {
      if (reminderState === "on") { await push.disableReminders(); setReminderState("off"); }
      else { await push.enableReminders(room); setReminderState(await push.getReminderState()); }
    } catch (e: any) {
      if (String(e?.message) === "denied") setReminderState("denied");
      // Un rifiuto del server: enableReminders ha gia' disfatto l'iscrizione del
      // browser, quindi lo stato riletto dice il vero ("non attive"). Qui resta
      // da dire PERCHE', altrimenti si tocca "attiva" e non succede nulla.
      else if (e?.rifiutato) {
        setPushErr(String(e.message));
        setReminderState(await push.getReminderState());
      }
    } finally { setBusy(false); }
  }

  const reminderSub = reminderState === "denied"
    ? T[lang].notificheBloccate
    : reminderState === "on" ? T[lang].attive : T[lang].nonAttive;

  const Row = ({ icon, label, sub: subtext, onClick }: {
    icon: React.ReactNode; label: string; sub?: string; onClick: () => void;
  }) => (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:scale-[0.99]">
      <span style={{ color: sub }}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold" style={{ color: fg }}>{label}</span>
        {subtext && <span className="block text-xs" style={{ color: sub }}>{subtext}</span>}
      </span>
      <ChevronRight size={16} style={{ color: sub, opacity: 0.5 }} />
    </button>
  );

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pb-6 max-h-[92%] overflow-y-auto overscroll-contain" style={{ background:"var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="px-6 pt-4 pb-3 flex items-center justify-between">
          <p className="text-lg font-bold" style={{ color:fg }}>{T[lang].impostazioni}</p>
          <button onClick={onClose} className="p-2 rounded-xl" style={{ color:sub, background:"var(--secondary)" }}>
            <X size={16}/>
          </button>
        </div>

        <div className="rounded-2xl overflow-hidden border mx-5" style={{ borderColor:div }}>
          <div style={{ borderBottom:`1px solid ${div}` }}>
            <Row icon={<Globe size={18}/>} label={T[lang].navLingua}
              sub={`${linguaCorrente?.bandiera ?? ""} ${linguaCorrente?.etichetta ?? ""}`}
              onClick={() => setLingueAperte((v) => !v)}/>
            {lingueAperte && (
              <div className="grid grid-cols-2 gap-x-1 p-1" style={{ background:"var(--secondary)" }}>
                {LINGUE.map((l) => (
                  <button key={l.id}
                    onClick={() => { onLang(l.id); setLingueAperte(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-lg"
                    style={{
                      color: l.id === lang ? RED : fg,
                      fontWeight: l.id === lang ? 600 : 400,
                    }}>
                    <span className="text-base shrink-0">{l.bandiera}</span>
                    <span className="truncate">{l.etichetta}</span>
                    {l.id === lang && <span className="ml-auto shrink-0">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {room && (
            <div style={{ borderBottom:`1px solid ${div}` }}>
              <Row icon={reminderState==="on" ? <BellRing size={18}/> : <Bell size={18}/>}
                label={T[lang].notificheTurni} sub={reminderSub}
                onClick={() => setRemindersOpen(true)}/>
            </div>
          )}
          {!standalone && (
            <div style={{ borderBottom:`1px solid ${div}` }}>
              <Row icon={<Download size={18}/>} label={T[lang].installaApp}
                onClick={() => { window.dispatchEvent(new Event("open-install")); onClose(); }}/>
            </div>
          )}
          <Row icon={<Eye size={18}/>} label={T[lang].accessibilita}
            onClick={() => { onAccessibility(); onClose(); }}/>
        </div>

        {/* Né l'accesso né l'uscita stanno qui.
            L'accesso si apre digitando 1935 al posto della camera: una voce di
            menu che il 99% di chi lo apre non può usare sarebbe solo rumore.
            L'uscita è il pulsante della camera in alto — toccarlo chiude la
            sessione e riporta alla scelta della stanza. Un solo posto, quello
            che si tocca comunque per cambiare identità, invece di tre sparsi
            fra menu e barre sopra ogni sezione. Qui resta solo la riga che
            dice a nome di chi si sta prenotando, che è l'informazione facile
            da perdere di vista. */}
        {adminRole !== null && (
          <p className="text-[11px] mx-5 mt-3 leading-snug flex items-start gap-2" style={{ color:sub }}>
            <ShieldCheck size={14} style={{ marginTop:1, flexShrink:0 }}/>
            <span>
              {/* Il ruolo per esteso, non "sistemista oppure FDO": da quando
                  esiste anche `staff`, quel ternario avrebbe etichettato lo
                  staff come portineria.

                  Prima un ternario it/en: chi guardava l'app in francese,
                  tedesco o spagnolo vedeva comunque questa frase in inglese,
                  perche' il ternario copriva solo due lingue su sei. */}
              {T[lang].sessioneAttiva(etichettaRuolo(adminRole))}
            </span>
          </p>
        )}
      </div>

      {remindersOpen && (
        <RemindersSheet lang={lang} room={room} state={reminderState} busy={busy}
          err={pushErr}
          onToggle={toggleReminders} onClose={() => setRemindersOpen(false)} />
      )}
    </div>
  );
}

// ─── Pannello promemoria: push + Telegram ──────────────────────────────────────
//
// Telegram è l'alternativa che conta su iPhone, dove le notifiche push delle
// web app funzionano solo se l'app è stata installata dalla schermata Home e
// restano capricciose. Il collegamento passa da un codice usa-e-getta: senza,
// chiunque potrebbe scrivere al bot "sono la 112" e ricevere i promemoria altrui.
function RemindersSheet({ lang, room, state, busy, err, onToggle, onClose }: {
  lang: Lang; room: string | null; state: push.ReminderState;
  busy: boolean; err: string | null; onToggle: () => void; onClose: () => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [tgBusy, setTgBusy] = useState(false);
  const [tgErr, setTgErr] = useState(false);
  const on = state === "on";
  const bot = import.meta.env.VITE_TELEGRAM_BOT as string | undefined;

  /**
   * Collega Telegram in un tocco solo.
   *
   * Il codice si genera e si passa al bot dentro il link `?start=<codice>`:
   * Telegram lo invia da solo (se l'utente ha già avviato il bot in passato)
   * o mostra il pulsante AVVIA da toccare una volta (la prima volta) — è
   * Telegram stesso a funzionare così, non c'è un modo per saltare quel tocco
   * al primissimo collegamento. Il codice resta visibile come riserva.
   *
   * Prima si apriva una finestra VUOTA e la si reindirizzava dopo la chiamata
   * di rete: molti browser bloccano proprio i popup vuoti-poi-reindirizzati
   * (è la firma di un pattern pubblicitario), quindi la finestra non si apriva
   * mai e il tentativo falliva in silenzio. Ora si apre già il link finale,
   * un solo passaggio, col fallback sulla stessa scheda se anche quello viene
   * bloccato.
   */
  async function linkTelegram() {
    setTgBusy(true); setTgErr(false);
    try {
      const c = await api.telegramCode();
      setCode(c);
      if (bot) {
        const link = `https://t.me/${bot}?start=${c}`;
        const w = window.open(link, "_blank", "noopener,noreferrer");
        if (!w) window.location.href = link;   // popup bloccato: si va diretti
      }
    } catch {
      setTgErr(true);
    } finally { setTgBusy(false); }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background:"rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pb-8 max-h-[92%] overflow-y-auto overscroll-contain" style={{ background:"var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4">
          <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background:"color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
          <div className="flex items-center justify-between mb-1">
            <p className="text-lg font-bold" style={{ color:"var(--foreground)" }}>
              {T[lang].promemoriaTurni}
            </p>
            <button onClick={onClose} className="p-2 rounded-xl" style={{ color:"var(--gray-accessible-text)", background:"var(--secondary)" }}>
              <X size={16}/>
            </button>
          </div>
          <p className="text-xs" style={{ color:"var(--gray-accessible-text)" }}>
            {T[lang].promemoriaDesc}
          </p>
        </div>

        <div className="px-5 space-y-3">
          {/* Notifiche del browser */}
          <div className="rounded-2xl border p-4" style={{ background:"var(--card)", borderColor:"var(--border)" }}>
            <div className="flex items-center gap-3">
              <BellRing size={18} style={{ color: on ? RED : "var(--gray-accessible-text)" }}/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color:"var(--foreground)" }}>
                  {T[lang].notifichePhone}
                </p>
                <p className="text-xs" style={{ color:"var(--gray-accessible-text)" }}>
                  {state === "unsupported"
                    ? T[lang].nonDisponibili
                    : state === "denied"
                    ? T[lang].bloccateBrowser
                    : on ? T[lang].attive : T[lang].nonAttive}
                </p>
              </div>
              {state !== "denied" && state !== "unsupported" && (
                <button onClick={onToggle} disabled={busy}
                  className="rounded-xl px-3 py-2 text-xs font-semibold shrink-0"
                  style={on
                    ? { background:"var(--secondary)", color:"var(--gray-accessible-text)" }
                    : { background:`color-mix(in srgb, ${RED} 12%, transparent)`, color:RED }}>
                  {busy ? "…" : on ? T[lang].disattiva : T[lang].attiva}
                </button>
              )}
            </div>

            {err && (
              <p className="text-xs mt-3" style={{ color:RED }}>
                {err}
              </p>
            )}
          </div>

          {/* Telegram */}
          <div className="rounded-2xl border p-4" style={{ background:"var(--card)", borderColor:"var(--border)" }}>
            <div className="flex items-center gap-3">
              <Send size={18} style={{ color:"var(--gray-accessible-text)" }}/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color:"var(--foreground)" }}>Telegram</p>
                <p className="text-xs" style={{ color:"var(--gray-accessible-text)" }}>
                  {T[lang].telegramDesc}
                </p>
              </div>
              <button onClick={linkTelegram} disabled={tgBusy || !room}
                className="rounded-xl px-3 py-2 text-xs font-semibold shrink-0"
                style={{ background:`color-mix(in srgb, ${RED} 12%, transparent)`, color:RED }}>
                {tgBusy ? "…" : code ? T[lang].riapri : T[lang].collega}
              </button>
            </div>

            {tgErr && (
              <p className="text-xs mt-3" style={{ color:RED }}>
                {T[lang].telegramErrore}
              </p>
            )}

            {code && (
              <div className="mt-3 pt-3" style={{ borderTop:"1px solid var(--border)" }}>
                <p className="text-xs" style={{ color:"var(--foreground)" }}>
                  {T[lang].telegramAperto}
                </p>
                {/* Riserva, non il percorso principale: serve solo se
                    l'apertura automatica non è andata a buon fine (popup
                    bloccato, Telegram non installato al primo tocco, ecc.).
                    Un link vero — non solo il nome del bot da cercare a mano — perché
                    ricopiare "@nome" e poi il codice a mano è l'esatto attrito
                    che il tocco automatico dovrebbe evitare. */}
                <p className="text-[11px] mt-2 mb-1.5" style={{ color:"var(--gray-accessible-text)" }}>
                  {T[lang].nonSiApre}
                </p>
                {bot ? (
                  <a href={`https://t.me/${bot}?start=${code}`} target="_blank" rel="noopener noreferrer"
                     className="block text-center text-xs font-semibold py-2.5 rounded-xl"
                     style={{ background:`color-mix(in srgb, ${RED} 12%, transparent)`, color:RED }}>
                    {T[lang].riprovaTelegram}
                  </a>
                ) : (
                  <p className="text-[11px]" style={{ color:"var(--gray-accessible-text)" }}>
                    {T[lang].scriviCodice}
                    <span className="font-mono font-bold tracking-wider" style={{ color:"var(--foreground)" }}>{code}</span>
                  </p>
                )}
                <p className="text-[11px] mt-2" style={{ color:"var(--gray-accessible-text)" }}>
                  {T[lang].codiceUsaEGetta}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Prompt installazione PWA ───────────────────────────────────────────────────
// Se l'app è già installata (standalone) o è già stata chiesta una volta → non
// mostra nulla. Altrimenti propone l'installazione: su Android usa il prompt
// nativo, su iPhone mostra le istruzioni (Condividi → Aggiungi a Home).
export function InstallPrompt({ lang }: { lang: Lang }) {
  const t = T[lang];
  const [deferred, setDeferred] = useState<any>(null);
  const [show, setShow] = useState(false);
  const isIOS = /iphone|ipad|ipod/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    if (standalone) return;
    let asked = false;
    try { asked = localStorage.getItem("einaudiplus.installAsked") === "1"; } catch {}
    if (asked) return;

    if (isIOS) {
      const id = setTimeout(() => setShow(true), 1500);
      return () => clearTimeout(id);
    }
    const onReady = () => { setDeferred((window as any).deferredPWAPrompt); setShow(true); };
    if ((window as any).deferredPWAPrompt) onReady();
    window.addEventListener("pwa-installable", onReady);
    return () => window.removeEventListener("pwa-installable", onReady);
  }, [isIOS]);

  // Apertura manuale dal pulsante in alto (ignora il flag "già chiesto").
  useEffect(() => {
    const open = () => { setDeferred((window as any).deferredPWAPrompt); setShow(true); };
    window.addEventListener("open-install", open);
    return () => window.removeEventListener("open-install", open);
  }, []);

  function close() {
    try { localStorage.setItem("einaudiplus.installAsked", "1"); } catch {}
    setShow(false);
  }
  async function install() {
    if (deferred) {
      deferred.prompt();
      try { await deferred.userChoice; } catch {}
    }
    close();
  }

  if (!show) return null;
  // Modalità: iOS (istruzioni Condividi), nativa (prompt del browser),
  // manuale (Android/Samsung senza prompt → istruzioni dal menu).
  const mode: "ios" | "native" | "manual" = isIOS ? "ios" : deferred ? "native" : "manual";
  const bodyText = mode === "ios" ? t.installIosBody : mode === "manual" ? t.installAndroidBody : t.installBody;
  return (
    <div className="absolute inset-0 z-50 flex items-end animate-toast-in" style={{ background: "rgba(0,0,0,0.55)" }} onClick={close}>
      <div className="w-full rounded-t-3xl pt-5 pb-7 px-6 max-h-[92%] overflow-y-auto overscroll-contain" style={{ background: "var(--background)" }} onClick={(e)=>e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2.5 rounded-2xl" style={{ background: `color-mix(in srgb, var(--primary) 15%, transparent)`, color: RED }}>
            <Download size={20}/>
          </div>
          <p className="text-lg font-bold" style={{ color: "var(--foreground)" }}>{t.installTitle}</p>
        </div>
        <p className="text-sm leading-relaxed mb-5" style={{ color: "var(--gray-accessible-text)" }}>{bodyText}</p>
        {mode === "native" ? (
          <button onClick={install}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold mb-2 transition-all active:scale-[0.98]"
            style={{ background: RED, color: RED_FG }}>
            <Download size={16}/>{t.installCta}
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 mb-2 border text-center"
            style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}>
            {mode === "ios" ? <Share size={16} style={{ color: RED }}/> : <Menu size={16} style={{ color: RED }}/>}
            <span className="text-sm font-medium">{mode === "ios" ? t.installIosStep : t.installAndroidStep}</span>
          </div>
        )}
        <button onClick={close} className="w-full py-3 rounded-2xl text-sm font-medium" style={{ color: "var(--gray-accessible-text)" }}>
          {mode === "native" ? t.installLater : t.installIosDone}
        </button>
      </div>
    </div>
  );
}