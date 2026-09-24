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
    menuLabel: "Cosa mangi?",
    senzaGlutine: "Senza glutine",
    senzaGlutineHint: "Celiachia o intolleranza al glutine",
    noteLabel: "Note (facoltative)",
    notePlaceholder: "Allergie, intolleranze o altro che chi cucina deve sapere",
    note: "Note",
    partecipaBtn: "Partecipo",
    cambiaScelta: "Modifica",
    partecipi: "Partecipi!",
    menuScelto: (m: string) => `Menu: ${m}`,
    pagamentoTitolo: "Invia la tua quota",
    pagamentoDesc: "Usa uno dei link qui sotto per inviare la quota al delegato, poi tocca \"Ho pagato\".",
    causalePagamento: "Importante: scrivi il numero della tua camera nella causale (nota) del pagamento, così il delegato può abbinarlo a te.",
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
    menuLabel: "What do you eat?",
    senzaGlutine: "Gluten-free",
    senzaGlutineHint: "Coeliac disease or gluten intolerance",
    noteLabel: "Notes (optional)",
    notePlaceholder: "Allergies, intolerances or anything the cooks should know",
    note: "Notes",
    partecipaBtn: "I'm in",
    cambiaScelta: "Edit",
    partecipi: "You're in!",
    menuScelto: (m: string) => `Menu: ${m}`,
    pagamentoTitolo: "Send your share",
    pagamentoDesc: "Use one of the links below to send your share to the organizer, then tap \"I've paid\".",
    causalePagamento: "Important: put your room number in the payment note, so the organizer can match it to you.",
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
    menuLabel: "Tu manges quoi ?",
    senzaGlutine: "Sans gluten",
    senzaGlutineHint: "Maladie cœliaque ou intolérance au gluten",
    noteLabel: "Remarques (facultatif)",
    notePlaceholder: "Allergies, intolérances ou autre chose que les cuisiniers doivent savoir",
    note: "Remarques",
    partecipaBtn: "Je participe",
    cambiaScelta: "Modifier",
    partecipi: "Tu es inscrit·e !",
    menuScelto: (m: string) => `Menu : ${m}`,
    pagamentoTitolo: "Envoie ta part",
    pagamentoDesc: "Utilise un des liens ci-dessous pour envoyer ta part à l'organisateur, puis touche \"J'ai payé\".",
    causalePagamento: "Important : indique le numéro de ta chambre dans la note du paiement, pour que l'organisateur puisse te retrouver.",
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
    menuLabel: "Was isst du?",
    senzaGlutine: "Glutenfrei",
    senzaGlutineHint: "Zöliakie oder Glutenunverträglichkeit",
    noteLabel: "Hinweise (optional)",
    notePlaceholder: "Allergien, Unverträglichkeiten oder was die Köche sonst wissen sollten",
    note: "Hinweise",
    partecipaBtn: "Ich mache mit",
    cambiaScelta: "Ändern",
    partecipi: "Du bist dabei!",
    menuScelto: (m: string) => `Menü: ${m}`,
    pagamentoTitolo: "Sende deinen Anteil",
    pagamentoDesc: "Nutze einen der Links unten, um deinen Anteil an den Organisator zu senden, und tippe dann auf \"Bezahlt\".",
    causalePagamento: "Wichtig: Gib deine Zimmernummer in der Zahlungsnotiz an, damit der Organisator sie dir zuordnen kann.",
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
    menuLabel: "¿Qué comes?",
    senzaGlutine: "Sin gluten",
    senzaGlutineHint: "Celiaquía o intolerancia al gluten",
    noteLabel: "Notas (opcionales)",
    notePlaceholder: "Alergias, intolerancias u otra cosa que deban saber quienes cocinan",
    note: "Notas",
    partecipaBtn: "Participo",
    cambiaScelta: "Modificar",
    partecipi: "¡Estás dentro!",
    menuScelto: (m: string) => `Menú: ${m}`,
    pagamentoTitolo: "Envía tu parte",
    pagamentoDesc: "Usa uno de los enlaces de abajo para enviar tu parte al organizador, luego toca \"Ya he pagado\".",
    causalePagamento: "Importante: escribe el número de tu habitación en la nota del pago, para que el organizador pueda identificarte.",
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
    menuLabel: "Che magne?",
    senzaGlutine: "Senza glutine",
    senzaGlutineHint: "Celiachia o intolleranza ô glutine",
    noteLabel: "Note (si vuò)",
    notePlaceholder: "Allergie, intolleranze o chello ca chi cucina adda sapé",
    note: "Note",
    partecipaBtn: "Ce sto",
    cambiaScelta: "Cagna",
    partecipi: "Staje dinto!",
    menuScelto: (m: string) => `Menu: ${m}`,
    pagamentoTitolo: "Manna 'a quota toja",
    pagamentoDesc: "Adopera uno d''e link ccà sotto pe' mannà 'a quota, po' tocca \"Aggio pagato\".",
    causalePagamento: "Importante: scrive 'o nummero d''a cammera toja dint''a nota d''o pagamento, accussì 'o delegato te ricanosce.",
    paypalBtn: "Paga cu PayPal",
    satispayBtn: "Paga cu Satispay",
    dichiaraPagamento: "Aggio pagato",
    inAttesaConferma: "Aspettanno 'a conferma",
    pagamentoConfermato: "Pagamento confermato",
    erroreAzione: "Nun ha' fatto, prova n'ata vota.",
  },
} as const;

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

  // Form di adesione: menu, senza glutine, note. Non c'è più una scelta sì/no
  // da ricordare: aderire è l'unica azione, dichiarare un interesse attivo —
  // vedi la nota gemella in src/modules/grigliata/application/iscriviti.js.
  //
  // Si precompila da mia_adesione quando lo si APRE ("Modifica"), non a ogni
  // load(): load() gira ogni 10 secondi, e riscrivere i campi lì cancellava
  // una nota mentre la si stava ancora scrivendo.
  const [modificaScelta, setModificaScelta] = useState(false);
  // null = nessuna scelta ancora: vale il primo menu dell'evento (vedi
  // menuEffettivo più sotto) — gli id li conosciamo solo dopo il load().
  const [menuScelta, setMenuScelta] = useState<number | null>(null);
  const [senzaGlutine, setSenzaGlutine] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!camera) { setLoading(false); return; }
    setError(false);
    try {
      setStato(await api.getGrigliataStato());
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [camera]);

  function apriModifica() {
    const a = stato?.miaAdesione;
    if (a) { setMenuScelta(a.menuId); setSenzaGlutine(a.senzaGlutine); setNote(a.note ?? ""); }
    setModificaScelta(true);
  }

  // v1.3: i menu li decide il delegato per ogni grigliata, nell'ordine in
  // cui compaiono qui — il primo è quello "di base", preselezionato. I nomi
  // si mostrano come li ha scritti lui: non c'è una traduzione da fare.
  const menuDisponibili = stato?.evento?.menu ?? [];
  const menuEffettivo = menuDisponibili.some((m) => m.id === menuScelta)
    ? menuScelta
    : (menuDisponibili[0]?.id ?? null);
  const nomeMenu = (id: number) => menuDisponibili.find((m) => m.id === id)?.nome ?? "";

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
    if (busy || menuEffettivo == null) return;
    setBusy(true); setMsg(null);
    try {
      await api.grigliataIscriviti(menuEffettivo, senzaGlutine, note);
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
            <p className="text-sm font-semibold mb-2" style={{ color: fg }}>{t.menuLabel}</p>
            {/* Da uno a dieci menu, con nomi lunghi fino a 40 caratteri: una
                griglia che va a capo da sola, non tre colonne fisse. */}
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))" }}>
              {evento.menu.map((m) => {
                const scelto = menuEffettivo === m.id;
                return (
                  <button key={m.id} onClick={() => setMenuScelta(m.id)} aria-pressed={scelto}
                    className="rounded-xl py-2.5 px-1 text-sm font-semibold leading-tight transition-all"
                    lang="it"
                    style={{
                      // Un nome lungo va a capo fra le parole, o sillabato —
                      // non spezzato a caso ("Vegetarian|o").
                      hyphens: "auto", overflowWrap: "break-word",
                      ...(scelto ? { background: RED, color: RED_FG } : { background: "var(--secondary)", color: fg }),
                    }}>
                    {m.nome}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Un interruttore e non una quarta scelta di menu: si può essere
              vegani E senza glutine, sono due cose indipendenti. */}
          <button onClick={() => setSenzaGlutine((v) => !v)} role="switch" aria-checked={senzaGlutine}
            className="flex items-center justify-between gap-3 text-left">
            <span>
              <span className="block text-sm font-semibold" style={{ color: fg }}>{t.senzaGlutine}</span>
              <span className="block text-xs" style={{ color: sub }}>{t.senzaGlutineHint}</span>
            </span>
            <span className="shrink-0 flex items-center rounded-full p-[3px] transition-colors"
              style={{ width: 44, height: 26, background: senzaGlutine ? RED : "var(--secondary)", justifyContent: senzaGlutine ? "flex-end" : "flex-start" }}>
              <span className="rounded-full" style={{ width: 20, height: 20, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
            </span>
          </button>

          <label className="block">
            <span className="block text-sm font-semibold mb-2" style={{ color: fg }}>{t.noteLabel}</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2}
              placeholder={t.notePlaceholder}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none"
              style={{ background: "var(--secondary)", color: fg, border: `1px solid ${div}` }} />
          </label>

          <button onClick={salvaAdesione} disabled={busy || menuEffettivo == null}
            className="w-full py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
            style={{ background: RED, color: RED_FG, opacity: busy || menuEffettivo == null ? 0.6 : 1 }}>
            {t.partecipaBtn}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border p-4 flex flex-col gap-3" style={{ background: surf, borderColor: div }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Check size={16} style={{ color: RED }} />
              <p className="text-sm font-semibold" style={{ color: RED }}>{t.partecipi}</p>
            </div>
            <button onClick={apriModifica} className="text-xs font-semibold underline" style={{ color: sub }}>
              {t.cambiaScelta}
            </button>
          </div>
          <p className="text-xs" style={{ color: sub }}>
            {t.menuScelto(nomeMenu(miaAdesione!.menuId))}
            {miaAdesione!.senzaGlutine && ` · ${t.senzaGlutine}`}
          </p>
          {miaAdesione!.note && (
            <p className="text-xs whitespace-pre-wrap" style={{ color: sub, overflowWrap: "anywhere" }}>
              {t.note}: {miaAdesione!.note}
            </p>
          )}
        </div>
      )}

      {/* Il pagamento compare solo per chi ha già aderito (non mentre si sta
          ancora scegliendo il menu). */}
      {miaAdesione && !modificaScelta && (
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

              <p className="text-xs leading-relaxed rounded-xl px-3 py-2 font-medium"
                style={{ background: "color-mix(in srgb, var(--primary) 10%, transparent)", color: fg }}>
                {t.causalePagamento}
              </p>

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
