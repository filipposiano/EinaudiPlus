// Grigliata.tsx — sezione Grigliata: il residente aderisce, sceglie il
// menu, e dichiara di aver pagato la quota.
//
// Compare in navigazione SOLO quando una grigliata è attiva (vedi
// App.tsx, facilitiesFor/grigliataAttiva) — se non c'è nessuna grigliata la
// scheda sparisce del tutto, non resta lì vuota. Il lato del delegato (fa
// partire l'evento, vede chi ha aderito, conferma i pagamenti) vive in
// features/grigliata/admin/GrigliataAdmin.tsx.
//
// Stesso modello di fiducia di Bici.tsx: la camera è autodichiarata, non
// verificata — chi dice di essere la 214 aderisce per la 214.

import { useState, useEffect, useCallback } from "react";
import { Flame, Loader2, AlertTriangle, Check, ExternalLink } from "lucide-react";
import * as api from "../../api";
import type { Lang } from "../../i18n";

const RED = "var(--primary)", RED_FG = "var(--primary-foreground)";
const GREEN = "#22c55e";
const fg = "var(--foreground)", sub = "var(--muted-foreground)";
const surf = "var(--card)", div = "var(--border)";

const T = {
  it: {
    titolo: "Grigliata",
    loading: "Carico…",
    retry: "Riprova",
    netError: "Impossibile contattare il server.",
    soloCamere: "Questa sezione è per le camere: la Direzione non partecipa.",
    nessunaAttiva: "Non c'è nessuna grigliata attiva al momento.",
    scadeIl: (d: string) => `Le adesioni chiudono il ${d}`,
    domanda: "Parteciperai?",
    si: "Sì, parteciperò",
    no: "No, non parteciperò",
    cambiaScelta: "Cambia scelta",
    menuLabel: "Che menu preferisci?",
    menuClassico: "Classico",
    menuVegano: "Vegano",
    conferma: "Conferma",
    partecipi: "Partecipi!",
    menuScelto: (m: string) => `Menu: ${m}`,
    nonPartecipi: "Hai detto che non parteciperai.",
    pagamentoTitolo: "Invia la tua quota",
    pagamentoDesc: "Usa uno dei link qui sotto per inviare la quota al delegato, poi tocca \"Ho pagato\".",
    paypalBtn: "Paga con PayPal",
    satispayBtn: "Paga con Satispay",
    dichiaraPagamento: "Ho pagato",
    inAttesaConferma: "In attesa di conferma dal delegato",
    pagamentoConfermato: "Pagamento confermato",
    erroreAzione: "Non è riuscito, riprova.",
  },
  en: {
    titolo: "Barbecue",
    loading: "Loading…",
    retry: "Retry",
    netError: "Couldn't reach the server.",
    soloCamere: "This section is for rooms: the front desk doesn't take part.",
    nessunaAttiva: "There's no barbecue running right now.",
    scadeIl: (d: string) => `Sign-ups close on ${d}`,
    domanda: "Will you join?",
    si: "Yes, I'll join",
    no: "No, I won't join",
    cambiaScelta: "Change your answer",
    menuLabel: "Which menu?",
    menuClassico: "Classic",
    menuVegano: "Vegan",
    conferma: "Confirm",
    partecipi: "You're in!",
    menuScelto: (m: string) => `Menu: ${m}`,
    nonPartecipi: "You said you won't join.",
    pagamentoTitolo: "Send your share",
    pagamentoDesc: "Use one of the links below to send your share to the organizer, then tap \"I've paid\".",
    paypalBtn: "Pay with PayPal",
    satispayBtn: "Pay with Satispay",
    dichiaraPagamento: "I've paid",
    inAttesaConferma: "Waiting for the organizer to confirm",
    pagamentoConfermato: "Payment confirmed",
    erroreAzione: "That didn't work, try again.",
  },
  fr: {
    titolo: "Barbecue",
    loading: "Chargement…",
    retry: "Réessayer",
    netError: "Impossible de joindre le serveur.",
    soloCamere: "Cette section est pour les chambres : la Direction n'y participe pas.",
    nessunaAttiva: "Il n'y a aucun barbecue en cours.",
    scadeIl: (d: string) => `Les inscriptions ferment le ${d}`,
    domanda: "Tu participes ?",
    si: "Oui, je participe",
    no: "Non, je ne participe pas",
    cambiaScelta: "Changer de réponse",
    menuLabel: "Quel menu ?",
    menuClassico: "Classique",
    menuVegano: "Végétalien",
    conferma: "Confirmer",
    partecipi: "Tu es inscrit·e !",
    menuScelto: (m: string) => `Menu : ${m}`,
    nonPartecipi: "Tu as dit que tu ne participais pas.",
    pagamentoTitolo: "Envoie ta part",
    pagamentoDesc: "Utilise un des liens ci-dessous pour envoyer ta part à l'organisateur, puis touche \"J'ai payé\".",
    paypalBtn: "Payer avec PayPal",
    satispayBtn: "Payer avec Satispay",
    dichiaraPagamento: "J'ai payé",
    inAttesaConferma: "En attente de confirmation de l'organisateur",
    pagamentoConfermato: "Paiement confirmé",
    erroreAzione: "Ça n'a pas marché, réessaie.",
  },
  de: {
    titolo: "Grillfest",
    loading: "Wird geladen…",
    retry: "Nochmal versuchen",
    netError: "Server nicht erreichbar.",
    soloCamere: "Dieser Bereich ist für Zimmer: die Verwaltung nimmt nicht teil.",
    nessunaAttiva: "Gerade läuft kein Grillfest.",
    scadeIl: (d: string) => `Anmeldeschluss ist der ${d}`,
    domanda: "Machst du mit?",
    si: "Ja, ich mache mit",
    no: "Nein, ich mache nicht mit",
    cambiaScelta: "Antwort ändern",
    menuLabel: "Welches Menü?",
    menuClassico: "Klassisch",
    menuVegano: "Vegan",
    conferma: "Bestätigen",
    partecipi: "Du bist dabei!",
    menuScelto: (m: string) => `Menü: ${m}`,
    nonPartecipi: "Du hast gesagt, dass du nicht mitmachst.",
    pagamentoTitolo: "Sende deinen Anteil",
    pagamentoDesc: "Nutze einen der Links unten, um deinen Anteil an den Organisator zu senden, und tippe dann auf \"Bezahlt\".",
    paypalBtn: "Mit PayPal bezahlen",
    satispayBtn: "Mit Satispay bezahlen",
    dichiaraPagamento: "Bezahlt",
    inAttesaConferma: "Wartet auf Bestätigung durch den Organisator",
    pagamentoConfermato: "Zahlung bestätigt",
    erroreAzione: "Hat nicht geklappt, versuch's nochmal.",
  },
  es: {
    titolo: "Barbacoa",
    loading: "Cargando…",
    retry: "Reintentar",
    netError: "No se puede contactar con el servidor.",
    soloCamere: "Esta sección es para las habitaciones: la Dirección no participa.",
    nessunaAttiva: "No hay ninguna barbacoa activa ahora mismo.",
    scadeIl: (d: string) => `Las inscripciones cierran el ${d}`,
    domanda: "¿Participarás?",
    si: "Sí, participaré",
    no: "No, no participaré",
    cambiaScelta: "Cambiar respuesta",
    menuLabel: "¿Qué menú prefieres?",
    menuClassico: "Clásico",
    menuVegano: "Vegano",
    conferma: "Confirmar",
    partecipi: "¡Estás dentro!",
    menuScelto: (m: string) => `Menú: ${m}`,
    nonPartecipi: "Has dicho que no participarás.",
    pagamentoTitolo: "Envía tu parte",
    pagamentoDesc: "Usa uno de los enlaces de abajo para enviar tu parte al organizador, luego toca \"Ya he pagado\".",
    paypalBtn: "Pagar con PayPal",
    satispayBtn: "Pagar con Satispay",
    dichiaraPagamento: "Ya he pagado",
    inAttesaConferma: "Esperando confirmación del organizador",
    pagamentoConfermato: "Pago confirmado",
    erroreAzione: "No ha funcionado, inténtalo de nuevo.",
  },
  nap: {
    titolo: "Grigliata",
    loading: "Sto' carrecanno…",
    retry: "Prova n'ata vota",
    netError: "Nun riesco a parlà cu 'o server.",
    soloCamere: "Chesta sezione è pe' 'e cammere: 'a Direzione nun ce sta.",
    nessunaAttiva: "Mo nun ce sta nisciuna grigliata.",
    scadeIl: (d: string) => `'E adesioni chiudono ô ${d}`,
    domanda: "Vien'?",
    si: "Sì, vengo",
    no: "No, nun vengo",
    cambiaScelta: "Cagna risposta",
    menuLabel: "Che menu vuò?",
    menuClassico: "Classico",
    menuVegano: "Vegano",
    conferma: "Conferma",
    partecipi: "Staje dinto!",
    menuScelto: (m: string) => `Menu: ${m}`,
    nonPartecipi: "Hê ditto ca nun vien'.",
    pagamentoTitolo: "Manna 'a quota toja",
    pagamentoDesc: "Adopera uno d''e link ccà sotto pe' mannà 'a quota, po' tocca \"Aggio pagato\".",
    paypalBtn: "Paga cu PayPal",
    satispayBtn: "Paga cu Satispay",
    dichiaraPagamento: "Aggio pagato",
    inAttesaConferma: "Aspettanno 'a conferma",
    pagamentoConfermato: "Pagamento confermato",
    erroreAzione: "Nun ha' fatto, prova n'ata vota.",
  },
} as const;

type Menu = api.GrigliataMenu;

/**
 * Un link "paypal.me/mario", senza schema, è un URL RELATIVO per un
 * `<a href>`: il browser lo risolve contro la pagina corrente invece di
 * aprire PayPal — il bug per cui i link di pagamento non funzionavano.
 * grigliata_admin_crea() in SQL ora normalizza già quel che salva, ma
 * questo resta comunque: un dato salvato prima di quella correzione, o
 * scritto da un altro punto in futuro, deve aprirsi correttamente lo
 * stesso — costa una riga, non vale lasciarlo alla disciplina di chi scrive.
 */
function href(link: string): string {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
}

export default function GrigliataView({ lang, roomNumber }: { lang: Lang; roomNumber: string | null }) {
  const t = T[lang];
  // Come Bici: e' una scelta di camera, non della Direzione.
  const camera = roomNumber && roomNumber !== api.DIREZIONE ? roomNumber : null;

  const [stato, setStato] = useState<api.GrigliataStato | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Form di adesione, precompilato da mia_adesione una volta caricata — ma
  // resta modificabile: "cambia scelta" lo riapre senza dover ricaricare.
  const [modificaScelta, setModificaScelta] = useState(false);
  const [partecipaScelta, setPartecipaScelta] = useState(true);
  const [menuScelta, setMenuScelta] = useState<Menu>("classico");

  const load = useCallback(async () => {
    if (!camera) { setLoading(false); return; }
    setError(false);
    try {
      const s = await api.getGrigliataStato();
      setStato(s);
      if (s.miaAdesione) {
        setPartecipaScelta(s.miaAdesione.partecipa);
        if (s.miaAdesione.menu) setMenuScelta(s.miaAdesione.menu);
      }
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [camera]);

  useEffect(() => { load(); }, [load]);

  // Il delegato conferma un pagamento in un momento che il residente non
  // controlla: senza un ricontrollo periodico, "Pagamento confermato"
  // comparirebbe solo alla prossima apertura manuale della scheda. Stesso
  // intervallo di NotificheTab.tsx lato admin — si ferma quando la scheda
  // non è la visibile (cambio tab, telefono spento in tasca).
  useEffect(() => {
    if (!camera) return;
    const id = setInterval(() => { if (!document.hidden) load(); }, 10_000);
    return () => clearInterval(id);
  }, [camera, load]);

  async function salvaAdesione() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await api.grigliataIscriviti(partecipaScelta, partecipaScelta ? menuScelta : null);
      setModificaScelta(false);
      await load();
    } catch {
      setMsg(t.erroreAzione);
    } finally {
      setBusy(false);
    }
  }

  async function dichiaraPagato() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await api.grigliataDichiaraPagamento();
      await load();
    } catch {
      setMsg(t.erroreAzione);
    } finally {
      setBusy(false);
    }
  }

  if (!camera) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
        <Flame size={40} style={{ color: sub }} />
        <p className="text-sm" style={{ color: sub }}>{t.soloCamere}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: sub }}>
        <Loader2 size={26} className="animate-spin-slow" style={{ color: RED }} />
        <p className="text-sm">{t.loading}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center" style={{ color: sub }}>
        <AlertTriangle size={26} style={{ color: "var(--destructive)" }} />
        <p className="text-sm">{t.netError}</p>
        <button onClick={load} className="rounded-xl px-4 py-2 text-sm font-semibold" style={{ background: RED, color: RED_FG }}>
          {t.retry}
        </button>
      </div>
    );
  }

  if (!stato?.attiva || !stato.evento) {
    // Difensivo: App.tsx nasconde la scheda quando non c'e' una grigliata
    // attiva, ma una finestra fra "l'ho aperta" e "e' appena scaduta" resta
    // possibile — meglio un messaggio chiaro che una pagina vuota.
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
        <Flame size={40} style={{ color: sub }} />
        <p className="text-sm" style={{ color: sub }}>{t.nessunaAttiva}</p>
      </div>
    );
  }

  const { evento, miaAdesione } = stato;
  const scadenza = new Date(evento.scadenza).toLocaleString("it-IT", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });

  // Il form di adesione compare se non si e' ancora deciso, o se si e'
  // chiesto esplicitamente di cambiare scelta.
  const mostraForm = !miaAdesione || modificaScelta;

  return (
    <div className="flex flex-col h-full md:max-w-lg md:mx-auto md:w-full px-5 pt-3 pb-6 overflow-y-auto">
      {/* Nome della SEZIONE ("Grigliata", generico), non dell'evento: quello
          compare subito sotto, nella card. Ripetere qui evento.titolo lo
          mostrava due volte sullo stesso schermo su desktop. */}
      <div className="hidden md:flex items-center gap-2.5 mb-3">
        <div className="p-2 rounded-xl" style={{ background: "color-mix(in srgb, var(--primary) 15%, transparent)", color: RED }}>
          <Flame size={18} />
        </div>
        <h2 className="text-base font-bold" style={{ color: fg }}>{t.titolo}</h2>
      </div>

      <div className="rounded-2xl border p-4 mb-4" style={{ background: surf, borderColor: div }}>
        <p className="text-sm font-bold mb-1" style={{ color: fg }}>{evento.titolo}</p>
        <p className="text-xs" style={{ color: sub }}>{t.scadeIl(scadenza)}</p>
      </div>

      {msg && (
        <div className="rounded-xl px-4 py-2.5 mb-4 text-sm" style={{ background: "color-mix(in srgb, var(--destructive) 12%, transparent)", color: "var(--destructive-text)" }}>
          {msg}
        </div>
      )}

      {mostraForm ? (
        <div className="rounded-2xl border p-4 flex flex-col gap-4" style={{ background: surf, borderColor: div }}>
          <div>
            <p className="text-sm font-semibold mb-2" style={{ color: fg }}>{t.domanda}</p>
            <div className="grid grid-cols-2 gap-2">
              {([[true, t.si], [false, t.no]] as [boolean, string][]).map(([val, label]) => {
                const scelto = partecipaScelta === val;
                return (
                  <button key={String(val)} onClick={() => setPartecipaScelta(val)}
                    className="rounded-xl py-2.5 text-sm font-semibold transition-all"
                    style={scelto
                      ? { background: RED, color: RED_FG }
                      : { background: "var(--secondary)", color: fg }}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {partecipaScelta && (
            <div>
              <p className="text-sm font-semibold mb-2" style={{ color: fg }}>{t.menuLabel}</p>
              <div className="grid grid-cols-2 gap-2">
                {([["classico", t.menuClassico], ["vegano", t.menuVegano]] as [Menu, string][]).map(([val, label]) => {
                  const scelto = menuScelta === val;
                  return (
                    <button key={val} onClick={() => setMenuScelta(val)}
                      className="rounded-xl py-2.5 text-sm font-semibold transition-all"
                      style={scelto
                        ? { background: RED, color: RED_FG }
                        : { background: "var(--secondary)", color: fg }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button onClick={salvaAdesione} disabled={busy}
            className="w-full py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
            style={{ background: RED, color: RED_FG, opacity: busy ? 0.6 : 1 }}>
            {t.conferma}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border p-4 flex flex-col gap-3" style={{ background: surf, borderColor: div }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {miaAdesione!.partecipa && <Check size={16} style={{ color: RED }} />}
              <p className="text-sm font-semibold" style={{ color: miaAdesione!.partecipa ? RED : fg }}>
                {miaAdesione!.partecipa ? t.partecipi : t.nonPartecipi}
              </p>
            </div>
            <button onClick={() => setModificaScelta(true)} className="text-xs font-semibold underline" style={{ color: sub }}>
              {t.cambiaScelta}
            </button>
          </div>
          {miaAdesione!.partecipa && miaAdesione!.menu && (
            <p className="text-xs" style={{ color: sub }}>{t.menuScelto(miaAdesione!.menu === "vegano" ? t.menuVegano : t.menuClassico)}</p>
          )}
        </div>
      )}

      {/* Il pagamento compare solo per chi partecipa davvero (non mentre si
          sta ancora decidendo, e non per chi ha detto di no). */}
      {miaAdesione?.partecipa && !modificaScelta && (
        <div className="rounded-2xl border p-4 mt-4 flex flex-col gap-3" style={{ background: surf, borderColor: div }}>
          <p className="text-sm font-bold" style={{ color: fg }}>{t.pagamentoTitolo}</p>

          {miaAdesione.pagamentoConfermato ? (
            <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ background: `color-mix(in srgb, ${GREEN} 15%, transparent)`, color: GREEN }}>
              <Check size={16} />
              <p className="text-sm font-semibold">{t.pagamentoConfermato}</p>
            </div>
          ) : (
            <>
              <p className="text-xs leading-relaxed" style={{ color: sub }}>{t.pagamentoDesc}</p>

              <div className="flex flex-col gap-2">
                {evento.paypalLink && (
                  <a href={href(evento.paypalLink)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold"
                    style={{ background: "var(--secondary)", color: fg }}>
                    {t.paypalBtn}<ExternalLink size={14} />
                  </a>
                )}
                {evento.satispayLink && (
                  <a href={href(evento.satispayLink)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold"
                    style={{ background: "var(--secondary)", color: fg }}>
                    {t.satispayBtn}<ExternalLink size={14} />
                  </a>
                )}
              </div>

              {miaAdesione.pagamentoDichiarato ? (
                <p className="text-xs text-center font-semibold" style={{ color: sub }}>{t.inAttesaConferma}</p>
              ) : (
                <button onClick={dichiaraPagato} disabled={busy}
                  className="w-full py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
                  style={{ background: RED, color: RED_FG, opacity: busy ? 0.6 : 1 }}>
                  {t.dichiaraPagamento}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
