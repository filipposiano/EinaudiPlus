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
  legendFree:     "Verde — Libbera", legendFreeDesc: "A può prenotà momò.",
  legendInUse:    (t: string): string => `Giall — A stann usann — Turno in corso, fine alle ${t}.`,
  legendPrev:     "Cammera — Turno precedente — Indica chi stava primm e te.",
  legendOos:      "Russ — Nun funzion — A può pur prenotà, ma nun funzion.",
  legendAuto:     "Asciugatrice automatica — quann prenuot a lavatrice, se prenota pur l'asciugatrice",
  lgFree: "Libbera", lgInUse: "In uso", lgOos: "Nun funzion", lgPrev: "Chill primm e te",
  lgFreeD: "A può prenotà momò.",
  lgInUseD: (t: string): string => `Turno in corso, fine alle ${t}.`,
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
  notifichePhone: "Notifiche ru telefono",
  nonDisponibili: "Ngoppa stu cos non va",

  telegramDesc: "Utile ngoppa l'aifòn, aro e notifiche t fann sfastirià",

  riapri: "Apri nata vot",
  telegramErrore: "Nncia fatt. Prova nata vot.",
  nonSiApre: "Nun se apre?",
  riprovaTelegram: "Prova nata vot a apri Telegràm",
  scriviCodice: "Scriv stu codice a u bot: ",
  codiceUsaEGetta: "Valsul na jornat e scad in 24 or.",
};

export default nap;
