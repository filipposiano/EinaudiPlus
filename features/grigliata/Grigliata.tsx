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

import { useState, useEffect, useCallback, useRef } from "react";
import { Flame, Loader2, AlertTriangle, Check, ExternalLink, Ticket, ChevronsRight, Lock } from "lucide-react";
import * as api from "../../api";
import type { Lang } from "../../i18n";
import { EMOJI_TICKET_DEFAULT } from "./emojiTicket";
import { useAvvisiInTempoReale } from "../../realtime";

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
    scadeIlChiuse: (d: string) => `Le adesioni sono chiuse dal ${d}`,
    adesioniChiuse: "Le adesioni sono chiuse: non si può più aderire né cambiare scelta.",
    siMangiaIl: (d: string) => `Si mangia il ${d}`,
    menuLabel: "Quale menu desideri?",
    infoTitolo: "Informazioni su di te",
    infoDesc: "Così chi cucina può preparare qualcosa anche per te.",
    dietaLabel: "Segui una dieta particolare?",
    dietaClassico: "Mangio di tutto",
    dietaVegetariano: "Vegetariano",
    dietaVegano: "Vegano",
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
    quota: (q: string) => `Quota a persona: ${q}`,
    pagamentiDisattivati: "Per ora i pagamenti sono disattivati: non devi inviare niente dall'app. Il delegato ti farà sapere se e come pagare.",
    pagamentoDesc: "Usa uno dei link qui sotto per inviare la quota al delegato, poi tocca \"Ho pagato\".",
    causalePagamento: "Importante: scrivi il numero della tua camera nella causale (nota) del pagamento, così il delegato può abbinarlo a te.",
    paypalBtn: "Paga con PayPal",
    satispayBtn: "Paga con Satispay",
    dichiaraPagamento: "Ho pagato",
    inAttesaConferma: "In attesa di conferma dal delegato",
    pagamentoConfermato: "Pagamento confermato",
    erroreAzione: "Non è riuscito, riprova.",
    ticketTitolo: "I tuoi ticket",
    ticketScorriUsa: "Scorri per usare",
    ticketUsaHint: "Scorri solo davanti a chi ti serve: il numero compare in quel momento, non prima.",
    ticketUsato: (n: number) => `Usato · n. ${n}`,
    ticketBloccato: (d: string) => `Si sbloccano il ${d}`,
    ticketUsatoAlle: "Usato alle",
    ticketUsatoChiudi: "Fatto",
    ticketNumero: "Numero",
  },
  en: {
    titolo: "Barbecue",
    loading: "Loading…",
    retry: "Retry",
    netError: "Couldn't reach the server.",
    soloCamere: "This section is for rooms: the front desk doesn't take part.",
    nessunaAttiva: "There's no barbecue running right now.",
    scadeIl: (d: string) => `Sign-ups close on ${d}`,
    scadeIlChiuse: (d: string) => `Sign-ups closed on ${d}`,
    adesioniChiuse: "Sign-ups are closed: you can no longer join or change your choice.",
    siMangiaIl: (d: string) => `It's happening on ${d}`,
    menuLabel: "Which menu would you like?",
    infoTitolo: "About you",
    infoDesc: "So the cooks can prepare something for you too.",
    dietaLabel: "Any dietary preference?",
    dietaClassico: "I eat everything",
    dietaVegetariano: "Vegetarian",
    dietaVegano: "Vegan",
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
    quota: (q: string) => `Share per person: ${q}`,
    pagamentiDisattivati: "Payments are turned off for now: you don't need to send anything through the app. The organizer will let you know if and how to pay.",
    pagamentoDesc: "Use one of the links below to send your share to the organizer, then tap \"I've paid\".",
    causalePagamento: "Important: put your room number in the payment note, so the organizer can match it to you.",
    paypalBtn: "Pay with PayPal",
    satispayBtn: "Pay with Satispay",
    dichiaraPagamento: "I've paid",
    inAttesaConferma: "Waiting for the organizer to confirm",
    pagamentoConfermato: "Payment confirmed",
    erroreAzione: "That didn't work, try again.",
    ticketTitolo: "Your tickets",
    ticketScorriUsa: "Slide to use",
    ticketUsaHint: "Only slide in front of whoever's serving: the number appears at that moment, not before.",
    ticketUsato: (n: number) => `Used · #${n}`,
    ticketBloccato: (d: string) => `Unlocks on ${d}`,
    ticketUsatoAlle: "Used at",
    ticketUsatoChiudi: "Done",
    ticketNumero: "Number",
  },
  fr: {
    titolo: "Barbecue",
    loading: "Chargement…",
    retry: "Réessayer",
    netError: "Impossible de joindre le serveur.",
    soloCamere: "Cette section est pour les chambres : la Direction n'y participe pas.",
    nessunaAttiva: "Il n'y a aucun barbecue en cours.",
    scadeIl: (d: string) => `Les inscriptions ferment le ${d}`,
    scadeIlChiuse: (d: string) => `Inscriptions fermées depuis le ${d}`,
    adesioniChiuse: "Les inscriptions sont fermées : tu ne peux plus t'inscrire ni modifier ton choix.",
    siMangiaIl: (d: string) => `Ça se passe le ${d}`,
    menuLabel: "Quel menu souhaites-tu ?",
    infoTitolo: "À propos de toi",
    infoDesc: "Pour que les cuisiniers puissent prévoir quelque chose pour toi aussi.",
    dietaLabel: "Un régime particulier ?",
    dietaClassico: "Je mange de tout",
    dietaVegetariano: "Végétarien",
    dietaVegano: "Végétalien",
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
    quota: (q: string) => `Part par personne : ${q}`,
    pagamentiDisattivati: "Les paiements sont désactivés pour le moment : tu n'as rien à envoyer depuis l'app. L'organisateur te dira si et comment payer.",
    pagamentoDesc: "Utilise un des liens ci-dessous pour envoyer ta part à l'organisateur, puis touche \"J'ai payé\".",
    causalePagamento: "Important : indique le numéro de ta chambre dans la note du paiement, pour que l'organisateur puisse te retrouver.",
    paypalBtn: "Payer avec PayPal",
    satispayBtn: "Payer avec Satispay",
    dichiaraPagamento: "J'ai payé",
    inAttesaConferma: "En attente de confirmation de l'organisateur",
    pagamentoConfermato: "Paiement confirmé",
    erroreAzione: "Ça n'a pas marché, réessaie.",
    ticketTitolo: "Tes tickets",
    ticketScorriUsa: "Glisse pour utiliser",
    ticketUsaHint: "Glisse seulement devant la personne qui te sert : le numéro apparaît à ce moment-là, pas avant.",
    ticketUsato: (n: number) => `Utilisé · n° ${n}`,
    ticketBloccato: (d: string) => `Se débloquent le ${d}`,
    ticketUsatoAlle: "Utilisé à",
    ticketUsatoChiudi: "Terminé",
    ticketNumero: "Numéro",
  },
  de: {
    titolo: "Grillfest",
    loading: "Wird geladen…",
    retry: "Nochmal versuchen",
    netError: "Server nicht erreichbar.",
    soloCamere: "Dieser Bereich ist für Zimmer: die Verwaltung nimmt nicht teil.",
    nessunaAttiva: "Gerade läuft kein Grillfest.",
    scadeIl: (d: string) => `Anmeldeschluss ist der ${d}`,
    scadeIlChiuse: (d: string) => `Anmeldeschluss war der ${d}`,
    adesioniChiuse: "Die Anmeldung ist geschlossen: du kannst dich nicht mehr anmelden oder deine Wahl ändern.",
    siMangiaIl: (d: string) => `Gefeiert wird am ${d}`,
    menuLabel: "Welches Menü möchtest du?",
    infoTitolo: "Über dich",
    infoDesc: "Damit die Köche auch für dich etwas vorbereiten können.",
    dietaLabel: "Ernährst du dich besonders?",
    dietaClassico: "Ich esse alles",
    dietaVegetariano: "Vegetarisch",
    dietaVegano: "Vegan",
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
    quota: (q: string) => `Anteil pro Person: ${q}`,
    pagamentiDisattivati: "Zahlungen sind vorerst deaktiviert: du musst über die App nichts senden. Der Organisator sagt dir, ob und wie du zahlst.",
    pagamentoDesc: "Nutze einen der Links unten, um deinen Anteil an den Organisator zu senden, und tippe dann auf \"Bezahlt\".",
    causalePagamento: "Wichtig: Gib deine Zimmernummer in der Zahlungsnotiz an, damit der Organisator sie dir zuordnen kann.",
    paypalBtn: "Mit PayPal bezahlen",
    satispayBtn: "Mit Satispay bezahlen",
    dichiaraPagamento: "Bezahlt",
    inAttesaConferma: "Wartet auf Bestätigung durch den Organisator",
    pagamentoConfermato: "Zahlung bestätigt",
    erroreAzione: "Hat nicht geklappt, versuch's nochmal.",
    ticketTitolo: "Deine Tickets",
    ticketScorriUsa: "Zum Einlösen wischen",
    ticketUsaHint: "Nur vor der servierenden Person wischen: die Nummer erscheint erst in diesem Moment.",
    ticketUsato: (n: number) => `Eingelöst · Nr. ${n}`,
    ticketBloccato: (d: string) => `Freigeschaltet am ${d}`,
    ticketUsatoAlle: "Eingelöst um",
    ticketUsatoChiudi: "Fertig",
    ticketNumero: "Nummer",
  },
  es: {
    titolo: "Barbacoa",
    loading: "Cargando…",
    retry: "Reintentar",
    netError: "No se puede contactar con el servidor.",
    soloCamere: "Esta sección es para las habitaciones: la Dirección no participa.",
    nessunaAttiva: "No hay ninguna barbacoa activa ahora mismo.",
    scadeIl: (d: string) => `Las inscripciones cierran el ${d}`,
    scadeIlChiuse: (d: string) => `Inscripciones cerradas desde el ${d}`,
    adesioniChiuse: "Las inscripciones están cerradas: ya no puedes apuntarte ni cambiar tu elección.",
    siMangiaIl: (d: string) => `Se celebra el ${d}`,
    menuLabel: "¿Qué menú quieres?",
    infoTitolo: "Sobre ti",
    infoDesc: "Así quienes cocinan pueden preparar algo también para ti.",
    dietaLabel: "¿Sigues alguna dieta?",
    dietaClassico: "Como de todo",
    dietaVegetariano: "Vegetariano",
    dietaVegano: "Vegano",
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
    quota: (q: string) => `Cuota por persona: ${q}`,
    pagamentiDisattivati: "Por ahora los pagos están desactivados: no tienes que enviar nada desde la app. El organizador te dirá si hay que pagar y cómo.",
    pagamentoDesc: "Usa uno de los enlaces de abajo para enviar tu parte al organizador, luego toca \"Ya he pagado\".",
    causalePagamento: "Importante: escribe el número de tu habitación en la nota del pago, para que el organizador pueda identificarte.",
    paypalBtn: "Pagar con PayPal",
    satispayBtn: "Pagar con Satispay",
    dichiaraPagamento: "Ya he pagado",
    inAttesaConferma: "Esperando confirmación del organizador",
    pagamentoConfermato: "Pago confirmado",
    erroreAzione: "No ha funcionado, inténtalo de nuevo.",
    ticketTitolo: "Tus tickets",
    ticketScorriUsa: "Desliza para usar",
    ticketUsaHint: "Desliza solo delante de quien te sirve: el número aparece en ese momento, no antes.",
    ticketUsato: (n: number) => `Usado · n.º ${n}`,
    ticketBloccato: (d: string) => `Se desbloquean el ${d}`,
    ticketUsatoAlle: "Usado a las",
    ticketUsatoChiudi: "Listo",
    ticketNumero: "Número",
  },
  nap: {
    titolo: "Grigliata",
    loading: "Sto' carrecanno…",
    retry: "Prova n'ata vota",
    netError: "Nun riesco a parlà cu 'o server.",
    soloCamere: "Chesta sezione è pe' 'e cammere: 'a Direzione nun ce sta.",
    nessunaAttiva: "Mo nun ce sta nisciuna grigliata.",
    scadeIl: (d: string) => `'E adesioni chiudono ô ${d}`,
    scadeIlChiuse: (d: string) => `'E adesioni so' chiuse da ô ${d}`,
    adesioniChiuse: "'E adesioni so' chiuse: nun se pò cchiù aderì né cagnà.",
    siMangiaIl: (d: string) => `Se magna ô ${d}`,
    menuLabel: "Qua menu vuò?",
    infoTitolo: "Dimme 'e te",
    infoDesc: "Accussì chi cucina te prepara pure a te quaccosa.",
    dietaLabel: "Tiene 'na dieta particolare?",
    dietaClassico: "Magno 'e tutto",
    dietaVegetariano: "Vegetariano",
    dietaVegano: "Vegano",
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
    quota: (q: string) => `Quota a cristiano: ${q}`,
    pagamentiDisattivati: "P' mo' 'e pagamente so' stutate: nun hê 'a mannà niente dall'app. 'O delegato te fa sapé si e comme pagà.",
    pagamentoDesc: "Adopera uno d''e link ccà sotto pe' mannà 'a quota, po' tocca \"Aggio pagato\".",
    causalePagamento: "Importante: scrive 'o nummero d''a cammera toja dint''a nota d''o pagamento, accussì 'o delegato te ricanosce.",
    paypalBtn: "Paga cu PayPal",
    satispayBtn: "Paga cu Satispay",
    dichiaraPagamento: "Aggio pagato",
    inAttesaConferma: "Aspettanno 'a conferma",
    pagamentoConfermato: "Pagamento confermato",
    erroreAzione: "Nun ha' fatto, prova n'ata vota.",
    ticketTitolo: "'E ticket tuoje",
    ticketScorriUsa: "Scorri pe' l'adoperà",
    ticketUsaHint: "Scorri sulamente nnanz'a chi te serve: 'o nummero esce sulo tanno, nun primm'.",
    ticketUsato: (n: number) => `Adoperato · n. ${n}`,
    ticketBloccato: (d: string) => `Se sbloccano 'o ${d}`,
    ticketUsatoAlle: "Adoperato a ll'ora",
    ticketUsatoChiudi: "Fatto",
    ticketNumero: "Nummero",
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

/** "20 settembre" da un `date` puro ("AAAA-MM-GG", senza orario) — split sui
 *  componenti invece di passare per `new Date(iso)`: letto come UTC e
 *  riformattato in fuso locale potrebbe slittare di un giorno. */
const LOCALE: Record<Lang, string> = { it: "it-IT", en: "en-GB", fr: "fr-FR", de: "de-DE", es: "es-ES", nap: "it-IT" };

function fmtGiorno(dataIso: string, lang: Lang): string {
  const [y, m, d] = dataIso.split("-").map(Number);
  if (!y || !m || !d) return dataIso;
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long" });
}

/** "AAAA-MM-GG" di oggi, nel fuso del dispositivo — stesso formato del
 *  `date` che il server salva, per un confronto diretto senza passare da
 *  `Date` (che introdurrebbe un fuso orario nel confronto). */
function oggiISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── Ticket ─────────────────────────────────────────────────────────────────
//
// Uno slider "scorri per usare" invece di un bottone: un ticket si spende
// con un gesto deliberato, da sinistra a destra fino in fondo — un tocco
// distratto mentre si scorre la pagina non lo brucia. Lasciato prima
// dell'85% della corsa torna indietro da solo.

const KNOB = 48, PAD = 4, SOGLIA = 0.85;

function SlideToUse({ label, disabled, onComplete }: {
  label: string; disabled: boolean; onComplete: () => Promise<boolean>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ px: number; x: number } | null>(null);
  const xRef = useRef(0);
  const [x, setXState] = useState(0);
  const [trascina, setTrascina] = useState(false);
  const [inCorso, setInCorso] = useState(false);

  const setX = (v: number) => { xRef.current = v; setXState(v); };
  const corsa = () => Math.max(1, (trackRef.current?.clientWidth ?? 0) - KNOB - PAD * 2);
  const bloccato = disabled || inCorso;

  async function completa() {
    setX(corsa());
    setInCorso(true);
    const ok = await onComplete();
    setInCorso(false);
    // Riuscito: il ticket diventa "usato" e questo slider sparisce col
    // prossimo load(). Fallito: torna all'inizio, si può riprovare.
    if (!ok) setX(0);
  }

  function giu(e: React.PointerEvent<HTMLDivElement>) {
    if (bloccato) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, x: xRef.current };
    setTrascina(true);
  }
  function muovi(e: React.PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    setX(Math.min(corsa(), Math.max(0, start.current.x + e.clientX - start.current.px)));
  }
  function su() {
    if (!start.current) return;
    start.current = null;
    setTrascina(false);
    if (xRef.current >= corsa() * SOGLIA) completa();
    else setX(0);
  }

  const progresso = Math.min(1, x / corsa());

  return (
    <div ref={trackRef} className="relative w-full rounded-full overflow-hidden select-none"
      style={{
        height: KNOB + PAD * 2,
        background: `color-mix(in srgb, ${RED} 12%, var(--secondary))`,
        opacity: disabled ? 0.55 : 1,
      }}>
      {/* La scia dietro la manopola: si riempie mentre si trascina. */}
      <div className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: x + KNOB + PAD * 2,
          background: `color-mix(in srgb, ${RED} 30%, transparent)`,
          transition: trascina ? "none" : "width .25s ease",
        }} />
      <p className="absolute inset-0 flex items-center justify-center text-sm font-semibold pointer-events-none"
        style={{ color: fg, opacity: 1 - progresso * 1.4, paddingLeft: KNOB }}>
        {inCorso ? <Loader2 size={18} className="animate-spin-slow" /> : label}
      </p>
      <div role="button" tabIndex={bloccato ? -1 : 0} aria-label={label} aria-disabled={bloccato}
        onPointerDown={giu} onPointerMove={muovi} onPointerUp={su} onPointerCancel={su}
        onKeyDown={(e) => { if (!bloccato && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); completa(); } }}
        className="absolute rounded-full flex items-center justify-center"
        style={{
          top: PAD, left: PAD, width: KNOB, height: KNOB,
          transform: `translateX(${x}px)`,
          transition: trascina ? "none" : "transform .25s ease",
          background: RED, color: RED_FG,
          boxShadow: "0 2px 8px rgba(0,0,0,.25)",
          touchAction: "none", cursor: bloccato ? "default" : "grab",
        }}>
        {disabled ? <Lock size={18} /> : <ChevronsRight size={22} />}
      </div>
    </div>
  );
}

/** Una carta-ticket: emoji e nome sopra, una linea tratteggiata con le due
 *  tacche laterali come un biglietto vero, sotto lo slider (o lo stato
 *  "usato" col suo numero). */
function TicketCard({ tk, t, bloccatoFino, onUsa }: {
  tk: api.GrigliataTicket;
  t: (typeof T)[Lang];
  bloccatoFino: string | null;
  onUsa: () => Promise<boolean>;
}) {
  const tacca = (lato: "left" | "right") => (
    <span className="absolute rounded-full"
      style={{ width: 18, height: 18, top: -9, [lato]: -9, background: "var(--background)", border: `1px solid ${div}` }} />
  );
  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{
        background: tk.usato ? `color-mix(in srgb, ${GREEN} 8%, ${surf})` : surf,
        borderColor: tk.usato ? `color-mix(in srgb, ${GREEN} 35%, ${div})` : div,
      }}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="shrink-0 flex items-center justify-center rounded-2xl"
          style={{
            width: 52, height: 52, fontSize: 30, lineHeight: 1,
            background: tk.usato ? `color-mix(in srgb, ${GREEN} 15%, transparent)` : `color-mix(in srgb, ${RED} 12%, transparent)`,
            filter: tk.usato ? "grayscale(0.6)" : "none",
          }}>
          {tk.emoji || EMOJI_TICKET_DEFAULT}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-tight" style={{ color: fg, overflowWrap: "anywhere" }}>{tk.nome}</p>
          {tk.usato && (
            <p className="text-xs font-semibold mt-0.5 flex items-center gap-1" style={{ color: GREEN }}>
              <Check size={13} />{t.ticketUsato(tk.numero ?? 0)}
            </p>
          )}
        </div>
        {tk.usato && tk.numero != null && (
          <span className="shrink-0 text-2xl font-extrabold tabular-nums" style={{ color: GREEN }}>#{tk.numero}</span>
        )}
      </div>

      {!tk.usato && (
        <div className="relative px-4 pt-3.5 pb-4" style={{ borderTop: `2px dashed ${div}` }}>
          {tacca("left")}{tacca("right")}
          <SlideToUse
            label={bloccatoFino ? t.ticketBloccato(bloccatoFino) : t.ticketScorriUsa}
            disabled={bloccatoFino != null}
            onComplete={onUsa} />
        </div>
      )}
    </div>
  );
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
  // Lo slider portato in fondo apre una schermata a tutto schermo con
  // emoji, nome e numero in grande — la "prova" che il ticket è stato speso
  // proprio ora, non solo una riga in più nella lista (vedi usaTicket()).
  const [ticketAppenaUsato, setTicketAppenaUsato] = useState<{
    nome: string; emoji: string; numero: number; quando: Date;
  } | null>(null);

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
  // Indipendente dal menu: si può scegliere "Carne" (uno dei menu del
  // delegato) e dichiararsi comunque vegani — non è una quarta scelta di
  // menu, è un'informazione a parte (vedi la nota gemella in
  // src/modules/grigliata/domain/validazione.js).
  const [dieta, setDieta] = useState<api.GrigliataDieta>("classico");
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
    if (a) { setMenuScelta(a.menuId); setDieta(a.dieta); setSenzaGlutine(a.senzaGlutine); setNote(a.note ?? ""); }
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
  const nomeDieta = (d: api.GrigliataDieta) => (d === "vegano" ? t.dietaVegano : d === "vegetariano" ? t.dietaVegetariano : null);

  useEffect(() => { load(); }, [load]);

  // Il delegato conferma un pagamento in un momento che il residente non
  // controlla. v1.9: lo si sa SUBITO dagli avvisi in tempo reale (vedi
  // realtime.ts) — solo quelli di QUESTA camera (conferma, ticket) e quelli
  // dell'evento (menu, orari, chiusura), non i ticket degli altri: il giorno
  // della grigliata siamo ~90 connessi, e ogni ticket usato non deve far
  // ricaricare tutti. Il canale di tutti aspetta un po' a caso prima di
  // ricaricare, così 90 telefoni non chiedono nello stesso istante.
  const inTempoReale = useAvvisiInTempoReale(
    camera
      ? [{ topic: "grigliata:tutti", jitterMs: 4000, minimoMs: 15_000 }, { topic: `grigliata:camera:${camera}`, jitterMs: 300, minimoMs: 2000 }]
      : [],
    load,
    Boolean(camera),
  );

  // Rete di sicurezza: un ricontrollo periodico — ogni minuto se gli avvisi
  // arrivano, ogni 10 secondi (come prima) se non sono disponibili. Si ferma
  // quando la scheda non è visibile (telefono in tasca).
  useEffect(() => {
    if (!camera) return;
    const id = setInterval(() => { if (!document.hidden) load(); }, inTempoReale ? 60_000 : 10_000);
    return () => clearInterval(id);
  }, [camera, load, inTempoReale]);

  async function salvaAdesione() {
    if (busy || menuEffettivo == null) return;
    setBusy(true); setMsg(null);
    try {
      await api.grigliataIscriviti(menuEffettivo, dieta, senzaGlutine, note);
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

  // Va fatto DAVANTI a chi serve il cibo, non prima: il numero progressivo
  // (unico per tutta la grigliata, vedi grigliata_usa_ticket in SQL) esiste
  // solo a partire da questo gesto — uno screenshot fatto in anticipo non
  // mostra niente. Torna true se è andato, così lo slider sa se tornare
  // indietro.
  async function usaTicket(tk: api.GrigliataTicket): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setMsg(null);
    try {
      const res = await api.grigliataUsaTicket(tk.id);
      setTicketAppenaUsato({
        nome: res.ticket_nome || tk.nome,
        emoji: res.ticket_emoji || tk.emoji || EMOJI_TICKET_DEFAULT,
        numero: res.ticket_numero,
        quando: new Date(),
      });
      await load();
      return true;
    } catch {
      setMsg(t.erroreAzione);
      return false;
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
  // v1.4.1: la quota a persona, se il delegato l'ha indicata — vale anche
  // con i pagamenti spenti (quanto portare sul posto).
  const quota = evento.quota == null ? null
    : evento.quota.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
  const scadenza = new Date(evento.scadenza).toLocaleString("it-IT", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });

  // Il form di adesione compare se non si e' ancora deciso, o se si e'
  // chiesto esplicitamente di cambiare scelta — ma solo finche' le iscrizioni
  // sono aperte: la scheda resta visibile fino al giorno dopo la grigliata,
  // e dopo la scadenza non si aderisce ne' si cambia piu' (vedi
  // grigliata_iscrivi in SQL).
  const iscrizioniAperte = evento.iscrizioniAperte;
  const mostraForm = iscrizioniAperte && (!miaAdesione || modificaScelta);

  // Dal giorno VERO dell'evento in poi (non dalla scadenza delle adesioni):
  // solo da qui gli slider dei ticket si sbloccano (prima si vedono, ma col
  // lucchetto). "In poi" e non "esattamente quel giorno" perche' la scheda
  // resta visibile anche il giorno dopo, e il server accetta l'uso dei
  // ticket fino ad allora — confronto per data di calendario del
  // dispositivo, stesso formato "AAAA-MM-GG" che il server salva.
  const eGiornoEvento = evento.giornoEvento <= oggiISO();
  const ticket = miaAdesione?.pagamentoConfermato ? miaAdesione.ticket : [];

  return (
    <>
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
        <p className="text-xs" style={{ color: sub }}>{t.siMangiaIl(fmtGiorno(evento.giornoEvento, lang))}</p>
        <p className="text-xs" style={{ color: sub }}>
          {iscrizioniAperte ? t.scadeIl(scadenza) : t.scadeIlChiuse(scadenza)}
        </p>
        {quota && <p className="text-xs font-semibold mt-1" style={{ color: fg }}>{t.quota(quota)}</p>}
      </div>

      {msg && (
        <div className="rounded-xl px-4 py-2.5 mb-4 text-sm" style={{ background: "color-mix(in srgb, var(--destructive) 12%, transparent)", color: "var(--destructive-text)" }}>
          {msg}
        </div>
      )}

      {/* Iscrizioni chiuse e nessuna adesione: la scheda resta visibile ma non
          c'è niente da fare — niente form, niente pagamento. */}
      {!iscrizioniAperte && !miaAdesione && (
        <div className="rounded-2xl border p-4 text-sm" style={{ background: surf, borderColor: div, color: sub }}>
          {t.adesioniChiuse}
        </div>
      )}

      {/* v1.4: il form è diviso in due blocchi — COSA si mangia (il menu del
          delegato) e CHI sei (dieta, glutine, note) — invece di un'unica
          card: sono due domande diverse, e la seconda vale qualunque menu
          si scelga. Il pulsante sta sotto entrambi: salva tutto insieme,
          i dati viaggiano come prima (stessa grigliata_iscrivi). */}
      {!iscrizioniAperte && !miaAdesione ? null : mostraForm ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border p-4" style={{ background: surf, borderColor: div }}>
            <div>
              <p className="text-sm font-bold mb-3" style={{ color: fg }}>{t.menuLabel}</p>
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
          </div>

          <div className="rounded-2xl border p-4 flex flex-col gap-4" style={{ background: surf, borderColor: div }}>
            <div>
              <p className="text-sm font-bold" style={{ color: fg }}>{t.infoTitolo}</p>
              <p className="text-xs mt-0.5" style={{ color: sub }}>{t.infoDesc}</p>
            </div>

            <div>
              <p className="text-sm font-semibold mb-2" style={{ color: fg }}>{t.dietaLabel}</p>
              {/* Tre pulsanti fissi, non legati ai menu del delegato: si può
                  scegliere QUALUNQUE menu e dichiararsi comunque vegani — è
                  un'informazione a parte, non una quarta scelta di menu. */}
              <div className="grid grid-cols-3 gap-2">
                {([["classico", t.dietaClassico], ["vegetariano", t.dietaVegetariano], ["vegano", t.dietaVegano]] as [api.GrigliataDieta, string][]).map(([val, label]) => {
                  const scelto = dieta === val;
                  return (
                    <button key={val} onClick={() => setDieta(val)} aria-pressed={scelto}
                      className="rounded-xl py-2.5 px-1 text-sm font-semibold leading-tight transition-all"
                      style={scelto
                        ? { background: RED, color: RED_FG }
                        : { background: "var(--secondary)", color: fg }}>
                      {label}
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
          </div>

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
            {iscrizioniAperte && (
              <button onClick={apriModifica} className="text-xs font-semibold underline" style={{ color: sub }}>
                {t.cambiaScelta}
              </button>
            )}
          </div>
          <p className="text-xs" style={{ color: sub }}>
            {t.menuScelto(nomeMenu(miaAdesione!.menuId))}
            {nomeDieta(miaAdesione!.dieta) && ` · ${nomeDieta(miaAdesione!.dieta)}`}
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
          ancora scegliendo il menu). Con i pagamenti spenti dal delegato
          (v1.4) la card resta, ma dice solo che per ora non si paga — niente
          link né "Ho pagato". */}
      {miaAdesione && !modificaScelta && (
        <div className="rounded-2xl border p-4 mt-4 flex flex-col gap-3" style={{ background: surf, borderColor: div }}>
          <div>
            <p className="text-sm font-bold" style={{ color: fg }}>{t.pagamentoTitolo}</p>
            {quota && <p className="text-xs mt-0.5" style={{ color: sub }}>{t.quota(quota)}</p>}
          </div>

          {!evento.pagamentiAttivi ? (
            <p className="text-xs leading-relaxed rounded-xl px-3 py-2 font-medium"
              style={{ background: "var(--secondary)", color: fg }}>
              {t.pagamentiDisattivati}
            </p>
          ) : miaAdesione.pagamentoConfermato ? (
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

      {/* I ticket: una sezione a sé, uno per ogni voce del menu scelto (es.
          "Carne" = 🌭 Salsiccia + 🥤 Bibita). Compaiono appena il pagamento
          è confermato — prima del giorno della grigliata si vedono ma con
          lo slider bloccato. */}
      {ticket.length > 0 && !modificaScelta && (
        <div className="mt-6 flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3 px-1">
            <div className="flex items-center gap-2">
              <Ticket size={18} style={{ color: RED }} />
              <p className="text-base font-bold" style={{ color: fg }}>{t.ticketTitolo}</p>
            </div>
            <p className="text-xs truncate" style={{ color: sub }}>{t.menuScelto(nomeMenu(miaAdesione!.menuId))}</p>
          </div>

          {ticket.map((tk) => (
            <TicketCard key={tk.id} tk={tk} t={t}
              bloccatoFino={eGiornoEvento ? null : fmtGiorno(evento.giornoEvento, lang)}
              onUsa={() => usaTicket(tk)} />
          ))}

          {eGiornoEvento && ticket.some((tk) => !tk.usato) && (
            <p className="text-xs leading-relaxed px-1" style={{ color: sub }}>{t.ticketUsaHint}</p>
          )}
        </div>
      )}
    </div>

    {/* Schermata a tutto schermo subito dopo lo slider: emoji, nome e numero
        in grande, la prova che il ticket è stato speso proprio ora — da
        mostrare a chi serve, non una riga da cercare nella lista. */}
    {ticketAppenaUsato && (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 px-8 text-center"
        style={{ background: `radial-gradient(circle at 50% 35%, color-mix(in srgb, ${RED} 70%, #fff) 0%, ${RED} 65%)` }}
        onClick={() => setTicketAppenaUsato(null)}>
        <div className="flex items-center justify-center rounded-full"
          style={{ width: 132, height: 132, fontSize: 76, lineHeight: 1, background: "rgba(255,255,255,0.2)" }}>
          {ticketAppenaUsato.emoji}
        </div>
        <p className="text-3xl font-extrabold mt-2" style={{ color: RED_FG, overflowWrap: "anywhere" }}>{ticketAppenaUsato.nome}</p>
        <div className="mt-2 rounded-3xl px-8 py-4" style={{ background: "rgba(0,0,0,0.18)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: RED_FG, opacity: 0.8 }}>{t.ticketNumero}</p>
          <p className="font-extrabold tabular-nums leading-none" style={{ color: RED_FG, fontSize: 88 }}>{ticketAppenaUsato.numero}</p>
        </div>
        {/* L'ora (coi secondi) in grande: identifica QUESTO uso del ticket —
            chi serve la confronta a colpo d'occhio, uno screenshot di un
            altro momento non torna. Il giorno no: è quello della grigliata,
            lo sanno tutti. */}
        <div className="flex flex-col items-center" style={{ color: RED_FG }}>
          <p className="text-sm font-semibold flex items-center gap-1.5 uppercase tracking-widest" style={{ opacity: 0.85 }}>
            <Check size={16} />{t.ticketUsatoAlle}
          </p>
          <p className="text-5xl font-extrabold tabular-nums leading-tight mt-1">
            {ticketAppenaUsato.quando.toLocaleTimeString(LOCALE[lang], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        </div>
        <button onClick={() => setTicketAppenaUsato(null)}
          className="mt-5 px-10 py-3 rounded-2xl text-sm font-bold"
          style={{ background: RED_FG, color: RED }}>
          {t.ticketUsatoChiudi}
        </button>
      </div>
    )}
    </>
  );
}
