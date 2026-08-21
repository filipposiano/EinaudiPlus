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

  washerLabel: "Lavatrice",
  dryerLabel:  "Asciugatrice",
  loading:        "Carico e prenotazioni…",
  netError:       "A computer non funzion. Controlla se piglia.",

  soloDirezione:  "Sto turno è ra Direzione: statt accort!",


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
