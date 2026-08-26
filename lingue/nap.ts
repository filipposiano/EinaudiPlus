// lingue/nap.ts — napoletano.
//
// ─────────────────────────────────────────────────────────────────────────
// A DIFFERENZA delle altre lingue, questa è PARZIALE.
//
// È un `Partial<Testi>`: contiene solo le voci tradotte, e tutto il resto
// ricade sull'italiano. Due motivi, e nessuno dei due è pigrizia.
//
// Primo: per un dialetto la ricaduta sull'italiano è quella giusta. Una frase
// non tradotta resta comprensibile, mentre in francese o in tedesco sarebbe
// un buco.
//
// Secondo: così si può riempire una riga alla volta. Aggiungi una voce, la
// vedi nell'app, passi alla successiva — senza che manchino novanta chiavi e
// la build si rifiuti di partire.
//
// ─────────────────────────────────────────────────────────────────────────
// QUESTE SOTTO SONO DA CORREGGERE.
//
// Le ho buttate giù solo per lasciare il formato pronto: non parlo
// napoletano e quasi certamente ci sono errori, di grafia e di tono. Sono un
// segnaposto, non una proposta. Correggile, cancellale, riscrivile — e
// aggiungi le altre prendendo le chiavi da it.ts.

import { WEEKLY_QUOTA } from "../modello";
import type { Testi } from "./it";

const nap: Partial<Testi> = {
  greeting: (h: number) => h < 12 ? "Bongiorno" : h < 17 ? "Bonasera" : "Bonasera",

  welcome:   "Einaudi Plus",
  enterRoom: "Miette 'o nummero d''a cammera toia",

  room:   "Cammera",
  camera: "cammera",

  free:  "Libbera",
  inUse: "Sta 'nfunziona",

  book:    "Prenòta",
  confirm: "Vabbuò",
  cancel:  "Lassa sta'",

  reportSent:     (lbl: string): string => `A uast pe ${lbl} è stat mannat. Gli admìn verificheranno.`,

  notaDesc:       "Qual è o problem? Famm capì",
  notaPlaceholder: "Es. non centrifuga, perde acqua…",
  prevHad:        (r: string): string => `A cammera ${r} tenev u turn primm e te — se l'è già pijat?`,
  legendFree:     "Libbera", legendFreeDesc: "A può prenotà momò.",
  legendInUse:    (t: string): string => `A stann usann — Turno 'e mo, fernesce ê ${t}.`,
  legendPrev:     "Cammera — Turno precedente — Indica chi stava primm e te.",
  legendOos:      "Nun funzion — A può pur prenotà, ma nun funzion.",
  legendAuto:     "Asciugatrice automatica — quann prenuot a lavatrice, se prenota pur l'asciugatrice",
  lgFree: "Libbera", lgInUse: "Sta 'nfunziona", lgOos: "Nun funzion", lgPrev: "Chill primm e te",
  lgFreeD: "Nisciuno s'ha pigliato stu turno.",
  lgInUseD: (t: string): string => `Turno 'e mo, fernesce ê ${t}.`,
  lgOosD: "U uast è confermat. A può pur prenotà, ma nun funzion.",
  lgPrevD: "A cammr che stav primm e te.",

  washerLabel: "Lavatrice",
  dryerLabel:  "Asciugatrice",
  loading:        "Carico e prenotazioni…",
  netError:       "A computer non funzion. Controlla se piglia.",

  insertRoom:     "Nummr e stanza",
  back:           "← Arret",
  changeRoom:     "Cagna camera",
  retry:          "Riprova",
  taken:          (r?: string): string => r ? `Già occupata dalla stanza ${r}` : "Già occupata",


  soloDirezione:  "Sto turno è ra Direzione: statt accort!",
  navLavanderia: "Lavanderij", navCinema: "O 'Cinema", navMusica: "A' Musica",

  navMacchine: "Machin", navSegnalazioni: "Segnalazion",
  navRicorrenti: "Ricorrent", navManutenzione: "Manutenzion",
  notaFacoltativa: "Facoltativo: a può nvia pur senza scriv nient.",
  inviaSegnalazione: "Invia a segnalazione",

  promemoriaDesc: "T'avvisamm poco prima che o turno tuo abbia.",
  yourBookings: "'E prenotazioni toie",
  bookToday:     "Prenota pe' oggi",
  bookTodayHint: "Piglia n'orario 'e chille libbere 'e oggi",
  bookOtherDay:     "Prenota pe' n'atu juorno",
  bookOtherDayHint: "Guarda tutta 'a semmana e scegli",
  backToDashboard:  "Torna â dashboard",
  navStrutture: "Menù",
  bookTitle: "Prenota",
  feedbackApp: "Che ne pienze 'e ll'app",
  machinesInfo: "Chi tene 'e machine 'a stu turno, e chi 'e tenéva primma.",
  notifichePhone: "Notifiche ru telefono",
  nonDisponibili: "Ngoppa stu cos non va",

  telegramDesc: "Utile ngoppa l'aifòn, aro e notifiche t fann sfastirià",

  riapri: "Apri nata vot",
  telegramErrore: "Nncia fatt. Prova nata vot.",
  nonSiApre: "Nun se apre?",
  riprovaTelegram: "Prova nata vot a apri Telegràm",
  scriviCodice: "Scriv stu codice a u bot: ",
  codiceUsaEGetta: "Valsul na jornat e scad in 24 or.",

  // ─────────────────────────────────────────────────────────────────────────
  // Da qui in giu': bozza dell'assistente per completare le chiavi rimaste,
  // cosi' l'app in napoletano non ricade piu' sull'italiano da nessuna parte.
  // Stesso avviso di sopra: non e' madrelingua, va riletta e corretta.

  fmtTime:  (d: Date): string => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
  fmtDay:   (d: Date): string => d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }),
  days: ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"],

  installTitle: "Installa Einaudi Plus",
  installBody: "Aggiungila â schermata Home: s'apre comm'a n'app a tutto schermo e te po' mannà 'e promemoria d''e turne.",
  installIosBody: "Pe' installarla ncopp' o iPhone: tuocca 'o tasto Condividi d''o browser, po' scieglie «Aggiungi a Home».",
  installIosStep: "Condividi  →  Aggiungi a Home",
  installAndroidBody: "Arape 'o menu d''o browser e scieglie «Aggiungi pagina a → Schermata Home» (o «Installa app»).",
  installAndroidStep: "Menu  →  Aggiungi a Schermata Home",
  installCta: "Installa",

  addFav: "Aggiungi preferito",
  chooseWasher: "Scieglie 'a lavatrice",

  feedback: "Feedback",
  feedbackPlaceholder: "Scrive ccà 'o messaggio tuoio…",
  feedbackThanks: "Grazie! Feedback mandato ✓",

  skip: "Vai nnanze senza fa' 'o login",

  machines: "Lavatrice",
  washers:  "Lavatrice",

  bookAnyway: "Prenota 'o stesso",

  oosWarnTitle: "Machina fore servizio",
  oosWarnBody: "L'amministrazione l'ha verificata e signata comm'a uasta. 'A può prenotà 'o stesso, ma è probabile ca nun funziona.",
  oosDryerWarn: (m: string): string => `L'asciugatrice ${m} sta fore servizio: forse haje 'a stennere 'o bucato.`,
  oosWasherWarn: (m: string): string => `'A lavatrice ${m} sta fore servizio: forse nun parte.`,

  currentSlot: "Turno 'e mo",
  inProgressNow: "In corso mo",
  noActiveBookings: "Nisciuna prenotazione attiva",
  freeTodayLabel: "turne libbere ogge",

  favorites: "Preferite",
  noFavs: "Tocca 'a ★ vicino a n'orario dint' â scheda Giornaliero pe' l'aggiungere ê preferite.",
  favFree: "Libbero",

  remainingChip: (n: number): string => n >= 0 ? `${n} rimast${n === 1 ? "a" : "e"}` : `${-n} 'e cchiù`,
  slotEndsIn: "Fernesce fra",
  remainingMsg: (n: number): string => n > 0
    ? `Può ancora prenotà ${n} ${n === 1 ? "turno" : "turne"} chesta semmana (max ${WEEKLY_QUOTA} a cammera).`
    : n === 0
    ? `Ha già usato tutt'e dduje turne 'e chesta semmana (max ${WEEKLY_QUOTA} a cammera).`
    : `Ha superato 'o limite settimanale 'e ${WEEKLY_QUOTA} turne (${-n} 'e cchiù).`,

  altraLavanderia: "Chella cammera è d''a n'ata lavanderia. Può prenotà sulo 'e machine d''o palazzo tuoio.",
  noQuota: "senza limite",
  howItWorks: "Comme funziona",
  autoWash: (_end: string): string => "Lavatrice corrispondente prenotata automaticamente pe' 'o turno appriesso.",

  daily: "Giornaliero",
  thisWeek: "Semmana corrente",

  forMe: (r: string): string => `Pe' me — Cammera ${r}`,
  forOther: "Pe' quaccun'ato",
  forDirezione: "Pe' 'a Direzione",
  whoIsIt: "Pe' chi è 'a prenotazione?",
  chooseFree: "Scieglie na lavatrice libbera",
  occupied: "Occupata",
  autoReserved: (lbl: string, t: string): string => `Asciugatrice ${lbl} auto-riservata: ${t}`,
  confirmBooking: "Cunferma 'a prenotazione",
  slotConfirmed: "Prenotazione cunfermata",
  slotUpdated: "Prenotazione aggiornata",
  slotDeleted: "Prenotazione levata",
  wantModify: "Vuò cagnà chesta prenotazione?",
  bookedBy: (r: string): string => `Prenotata d''a cammera ${r}`,

  machineMgmt: "Gestione machine",
  reportOos: "Signala nu uasto",
  restore: "Rimette a posto",
  oosDesc: "Signala na machina ca nun funziona: n'amministratore verifica e 'a mette fore servizio.",
  reminderSent: (r: string): string => `Reminder mandato · Cammera ${r}`,
  oosSet: (lbl: string): string => `${lbl} signalata fore servizio`,
  oosCleared: (lbl: string): string => `${lbl} rimessa a posto`,
  reportAction: "Signala",
  alreadyOos: "Già signalata",

  booked: (lbl: string): string => `Lavatrice ${lbl} prenotata!`,
  backModify: "← Cagna",
  genericError: "Errore, prova n'ata vota.",

  amministrazione: "Amministrazione",
  mesiBrevi: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
  navLingua: "Lengua",
  impostazioni: "Impostazioni",
  notificheTurni: "Notifiche turne",
  notificheBloccate: "Bluccate d''o browser",
  attive: "Attive",
  nonAttive: "Nun attive",
  installaApp: "Installa l'app",
  accessibilita: "Accessibilità",
  promemoriaTurni: "Promemoria turne",
  bloccateBrowser: "Bluccate dint' e impostazioni d''o browser",
  disattiva: "Disattiva",
  attiva: "Attiva",
  collega: "Collega",

  navConferenze: "Polivalente",
  salaConferenze: "Sala Polivalente",
  liberaOra: "Libbera mo",
  occupataOra: "Occupata mo",
  liberaDalle: (h: string): string => `Se libbera all'${h}`,
  nessunaOccupazione: "Nisciuna occupazione 'mparata.",
  lavBreve: "Lav.",
  navAccount: "Account",
  direzioneNome: "Direzione",
  sessioneAttiva: (r: string): string => `Sessione ${r} attiva: prenote comm'a Direzione. Pe' asci' tuocca DIREZIONE 'ncoppa.`,
  telegramAperto: "Aggio aperto Telegram: tuocca AVVIA int' 'o bot e sî collegato.",
  usaTastiera: "Può pure scrivere cu 'a tastiera e appriette Invio.",
  autoReservedLabel: "'ncluta",
  giornoDopo: "(o juorno appriesso)",
};

export default nap;
