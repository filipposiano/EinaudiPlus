// i18n.ts — tutti i testi dell'app, in italiano e in inglese.
//
// Sta in un file suo perche' e' la cosa che si tocca piu' spesso e per i
// motivi meno tecnici: correggere una parola, cambiare un tono, aggiungere una
// lingua. Tenerlo dentro App.tsx voleva dire aprire duemila righe di
// componenti per sistemare una virgola.
//
// Le due lingue hanno le STESSE chiavi: se ne aggiungi una di qua, va aggiunta
// anche di la', altrimenti TypeScript se ne accorge al primo uso.

import { WEEKLY_QUOTA } from "./modello";

export type Lang = "it" | "en";
// ─── i18n ─────────────────────────────────────────────────────────────────────

export const T = {
  it: {
    greeting: (h: number) => h < 12 ? "Buongiorno" : h < 17 ? "Buon pomeriggio" : "Buonasera",
    fmtTime:  (d: Date) => d.toLocaleTimeString("it-IT", { hour:"2-digit", minute:"2-digit" }),
    fmtDay:   (d: Date) => d.toLocaleDateString("it-IT", { weekday:"long", day:"numeric", month:"long" }),
    days:     ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"],
    room:     "Camera", camera: "camera",
    welcome:  "Einaudi Plus", enterRoom: "Inserisci il numero della tua stanza per accedere",
    installTitle: "Installa Einaudi Plus",
    installBody: "Aggiungila alla schermata Home: si apre come un'app a tutto schermo e può inviarti i promemoria dei turni.",
    installIosBody: "Per installarla su iPhone: tocca il tasto Condividi del browser, poi scegli «Aggiungi a Home».",
    installIosStep: "Condividi  →  Aggiungi a Home",
    installAndroidBody: "Apri il menu del browser e scegli «Aggiungi pagina a → Schermata Home» (o «Installa app»).",
    installAndroidStep: "Menu  →  Aggiungi a Schermata Home",
    installCta: "Installa", installLater: "Più tardi", installIosDone: "Ho capito",
    addFav: "Aggiungi preferito", day: "Giorno", timeSlot: "Fascia oraria", favAlready: "Già nei preferiti",
    chooseWasher: "Scegli la lavatrice", noFreeWashers: "Nessuna lavatrice libera in questo turno.",
    feedback: "Feedback", feedbackBody: "Hai suggerimenti o hai trovato un problema? Scrivici.",
    feedbackPlaceholder: "Scrivi qui il tuo messaggio…", feedbackSend: "Invia", feedbackSending: "Invio feedback…",
    feedbackThanks: "Grazie! Feedback inviato ✓", feedbackError: "Invio non riuscito, riprova.",
    skip:     "Continua senza accedere",
    machines: "Lavatrici", // <--- AGGIUNTO
    washers:  "Lavatrici", dryers: "Asciugatrici", washer: "Lavatrice", dryer: "Asciugatrice",
    free:     "Libera", inUse: "In uso", oos: "Fuori servizio", operative: "Operativa",
    book:     "Prenota", reminder: "Reminder", sendReminder: "Manda reminder", sent: "Inviato ✓",
    bookAnyway:   "Prenota comunque",
    // Attenzione al significato: `is_oos` viene messo dall'amministratore DOPO
    // aver verificato una segnalazione, non dal residente che segnala. Quindi
    // qui il guasto è confermato, non in attesa di conferma.
    oosWarnTitle: "Macchina fuori servizio",
    oosWarnBody:  "L'amministrazione l'ha verificata e segnata come guasta. Puoi prenotarla lo stesso, ma è probabile che non funzioni.",
    oosDryerWarn: (m: string) => `L'asciugatrice ${m} è fuori servizio: potresti dover stendere il bucato.`,
    oosWasherWarn:(m: string) => `La lavatrice ${m} è fuori servizio: potrebbe non partire.`,
    currentSlot: "Turno corrente", prevSlot: "Turno precedente", now: "ora", prev: "prec.",
    yourBookings: "Le tue prenotazioni",
    inProgressNow: "In corso ora",
    noActiveBookings: "Nessuna prenotazione attiva",
    freeTodayLabel: "turni liberi oggi",
    favorites: "Preferiti",
    noFavs: "Tocca la ★ accanto a un orario nella scheda Giornaliero per aggiungerlo ai preferiti.",
    favFree: "Libero", favFull: "Pieno", favPast: "Passato",
    remainingChip: (n: number) => n >= 0 ? `${n} rimast${n === 1 ? "a" : "e"}` : `${-n} in più`,
    slotEndsIn: "Termina tra",
    remainingMsg: (n: number) => n > 0
      ? `Puoi ancora prenotare ${n} ${n === 1 ? "turno" : "turni"} questa settimana (max ${WEEKLY_QUOTA} a camera).`
      : n === 0
      ? `Hai usato entrambi i turni di questa settimana (max ${WEEKLY_QUOTA} a camera).`
      : `Hai superato il limite settimanale di ${WEEKLY_QUOTA} turni (${-n} in più).`,
    altraLavanderia: "Quella camera è dell'altra lavanderia. Puoi prenotare solo le macchine del tuo edificio.",
    noQuota: "senza limite",
    howItWorks: "Come funziona",
    autoWash: (_end: string) => `Lavatrice corrispondente prenotata automaticamente per il turno successivo.`,
    daily:    "Giornaliero", weekly: "Settimana", overview: "Panoramica",
    thisWeek: "Settimana corrente",
    confirm:  "Conferma", cancel: "Annulla", modify: "Modifica stanza", delete: "Elimina prenotazione",
    forMe:    (r: string) => `Per me — Camera ${r}`,
    forOther: "Per qualcun altro",
    forDirezione: "Per la Direzione",
    whoIsIt:  "Per chi è la prenotazione?",
    chooseFree: "Scegli una lavatrice libera",
    occupied: "Occupata",
    autoReserved: (lbl: string, t: string) => `Asciugatrice ${lbl} auto-riservata: ${t}`,
    confirmBooking: "Conferma prenotazione",
    slotConfirmed:  "Prenotazione confermata",
    slotUpdated:    "Prenotazione aggiornata",
    slotDeleted:    "Prenotazione eliminata",
    wantModify:     "Vuoi modificare questa prenotazione?",
    bookedBy:       (r: string) => `Prenotata dalla stanza ${r}`,
    machineMgmt:    "Gestione macchine",
    reportOos:      "Segnala un guasto",
    restore:        "Ripristina",
    oosDesc:        "Segnala una macchina che non funziona: un amministratore verifica e la mette fuori servizio.",
    reminderSent:   (r: string) => `Reminder inviato · Stanza ${r}`,
    oosSet:         (lbl: string) => `${lbl} segnalata fuori servizio`,
    oosCleared:     (lbl: string) => `${lbl} ripristinata`,
    reportAction:   "Segnala",
    alreadyOos:     "Già segnalata",
    reportSent:     (lbl: string) => `Guasto segnalato per ${lbl}. Un amministratore verificherà.`,
    washerLabel:    "Lavatrice",
    dryerLabel:     "Asciugatrice",
    notaDesc:       "Cosa non va? Facoltativo, ma aiuta a capire chi chiamare.",
    notaPlaceholder: "Es. non centrifuga, perde acqua…",
    booked:         (lbl: string) => `Lavatrice ${lbl} prenotata!`,
    prevHad:        (r: string) => `La stanza ${r} aveva questo turno prima di te — ha già ritirato il bucato?`,
    legendFree:     "Verde — Libera", legendFreeDesc: "Puoi prenotarla subito.",
    legendInUse:    (t: string) => `Giallo — In uso — Turno in corso, fine alle ${t}.`,
    legendPrev:     "Camera — Turno precedente — Indica chi aveva lo slot prima di te.",
    legendOos:      "Rosso — Fuori servizio — Puoi prenotarla comunque, a tuo rischio.",
    legendAuto:     "Asciugatrice automatica — prenotando una lavatrice, quella corrispondente viene riservata per il turno successivo.",
    lgFree: "Libera", lgInUse: "In uso", lgOos: "Fuori servizio", lgPrev: "Turno precedente",
    lgFreeD: "Puoi prenotarla subito.",
    lgInUseD: (t: string) => `Turno in corso, fine alle ${t}.`,
    lgOosD: "Guasto confermato dall'amministrazione. Puoi prenotarla comunque, a tuo rischio.",
    lgPrevD: "La camera che aveva lo slot prima di te.",
    insertRoom:     "Numero di stanza",
    back:           "← Indietro",
    backModify:     "← Modifica",
    changeRoom:     "Cambia camera",
    loading:        "Carico le prenotazioni…",
    retry:          "Riprova",
    netError:       "Impossibile contattare il foglio. Controlla la connessione.",
    taken:          (r?: string) => r ? `Già occupata dalla stanza ${r}` : "Già occupata",
    genericError:   "Errore, riprova.",
  },
  en: {
    greeting: (h: number) => h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening",
    fmtTime:  (d: Date) => d.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" }),
    fmtDay:   (d: Date) => d.toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long" }),
    days:     ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
    room:     "Room", camera: "room",
    welcome:  "Einaudi Plus", enterRoom: "Enter your room number to continue",
    installTitle: "Install Einaudi Plus",
    installBody: "Add it to your Home Screen: it opens like a full-screen app and can send you shift reminders.",
    installIosBody: "To install on iPhone: tap the browser Share button, then choose “Add to Home Screen”.",
    installIosStep: "Share  →  Add to Home Screen",
    installAndroidBody: "Open the browser menu and choose “Add page to → Home screen” (or “Install app”).",
    installAndroidStep: "Menu  →  Add to Home screen",
    installCta: "Install", installLater: "Later", installIosDone: "Got it",
    addFav: "Add favourite", day: "Day", timeSlot: "Time slot", favAlready: "Already a favourite",
    chooseWasher: "Choose a washer", noFreeWashers: "No free washer in this slot.",
    feedback: "Feedback", feedbackBody: "Got suggestions or found a problem? Let us know.",
    feedbackPlaceholder: "Type your message here…", feedbackSend: "Send", feedbackSending: "Sending feedback…",
    feedbackThanks: "Thanks! Feedback sent ✓", feedbackError: "Couldn't send, try again.",
    skip:     "Continue without logging in",
    machines: "Machines", // <--- AGGIUNTO
    washers:  "Washers", dryers: "Dryers", washer: "Washer", dryer: "Dryer",
    free:     "Free", inUse: "In use", oos: "Out of service", operative: "Operational",
    book:     "Book", reminder: "Remind", sendReminder: "Send reminder", sent: "Sent ✓",
    bookAnyway:   "Book anyway",
    oosWarnTitle: "Machine out of service",
    oosWarnBody:  "An admin has checked it and marked it broken. You can still book it, but it probably won't work.",
    oosDryerWarn: (m: string) => `Dryer ${m} is out of service: you may have to hang your laundry.`,
    oosWasherWarn:(m: string) => `Washer ${m} is out of service: it may not start.`,
    currentSlot: "Current slot", prevSlot: "Previous slot", now: "now", prev: "prev.",
    yourBookings: "Your bookings",
    inProgressNow: "In progress now",
    noActiveBookings: "No active bookings",
    freeTodayLabel: "free slots today",
    favorites: "Favourites",
    noFavs: "Tap the ★ next to a time in the Daily tab to add it to favourites.",
    favFree: "Free", favFull: "Full", favPast: "Past",
    remainingChip: (n: number) => n >= 0 ? `${n} left` : `${-n} extra`,
    slotEndsIn: "Ends in",
    remainingMsg: (n: number) => n > 0
      ? `You can book ${n} more ${n === 1 ? "slot" : "slots"} this week (max ${WEEKLY_QUOTA} per room).`
      : n === 0
      ? `You've used both your slots this week (max ${WEEKLY_QUOTA} per room).`
      : `You're over the weekly limit of ${WEEKLY_QUOTA} slots (${-n} extra).`,
    altraLavanderia: "That room belongs to the other laundry. You can only book machines in your own building.",
    noQuota: "no limit",
    howItWorks: "How it works",
    autoWash: (_end: string) => `Corresponding dryer auto-reserved for the next slot.`,
    daily:    "Daily", weekly: "Week", overview: "Overview",
    thisWeek: "Current week",
    confirm:  "Confirm", cancel:  "Cancel", modify: "Edit room", delete: "Delete booking",
    forMe:    (r: string) => `For me — Room ${r}`,
    forOther: "For someone else",
    forDirezione: "For the front desk",
    whoIsIt:  "Who is this booking for?",
    chooseFree: "Choose a free washer",
    occupied: "Taken",
    autoReserved: (lbl: string, t: string) => `Dryer ${lbl} auto-reserved: ${t}`,
    confirmBooking: "Confirm booking",
    slotConfirmed:  "Booking confirmed",
    slotUpdated:    "Booking updated",
    slotDeleted:    "Booking deleted",
    wantModify:     "Do you want to edit this booking?",
    bookedBy:       (r: string) => `Booked by room ${r}`,
    machineMgmt:    "Machine management",
    reportOos:      "Report a fault",
    restore:        "Restore",
    oosDesc:        "Report a machine that isn't working: an admin will check and mark it out of order.",
    reportAction:   "Report",
    alreadyOos:     "Already reported",
    reportSent:     (lbl: string) => `Fault reported for ${lbl}. An admin will check it.`,
    washerLabel:    "Washer",
    dryerLabel:     "Dryer",
    notaDesc:       "What is wrong? Optional, but it helps decide who to call.",
    notaPlaceholder: "e.g. will not spin, leaking…",
    reminderSent:   (r: string) => `Reminder sent · Room ${r}`,
    oosSet:         (lbl: string) => `${lbl} marked out of order`,
    oosCleared:     (lbl: string) => `${lbl} restored`,
    booked:         (lbl: string) => `Washer ${lbl} booked!`,
    prevHad:        (r: string) => `Room ${r} had this slot before you — have they collected their laundry?`,
    legendFree:     "Green — Free", legendFreeDesc: "Book it now.",
    legendInUse:    (t: string) => `Yellow — In use — Slot ends at ${t}.`,
    legendPrev:     "Room — Previous slot — Shows who had the slot before you.",
    legendOos:      "Red — Out of service — You can still book it, at your own risk.",
    legendAuto:     "Auto-dryer — booking a washer automatically reserves the matching dryer for the next slot.",
    lgFree: "Free", lgInUse: "In use", lgOos: "Out of service", lgPrev: "Previous slot",
    lgFreeD: "Book it now.",
    lgInUseD: (t: string) => `In progress, ends at ${t}.`,
    lgOosD: "Fault confirmed by an admin. You can still book it, at your own risk.",
    lgPrevD: "The room that had the slot before you.",
    insertRoom:     "Room number",
    back:           "← Back",
    backModify:     "← Edit",
    changeRoom:     "Change room",
    loading:        "Loading bookings…",
    retry:          "Retry",
    netError:       "Couldn't reach the sheet. Check your connection.",
    taken:          (r?: string) => r ? `Already taken by room ${r}` : "Already taken",
    genericError:   "Error, try again.",
  },
} as const;
// ─── Scorciatoie ─────────────────────────────────────────────────────────────

export const fmtTime = (d: Date, lang: Lang) => T[lang].fmtTime(d);
export const fmtDay  = (d: Date, lang: Lang) => T[lang].fmtDay(d);

/**
 * Traduce un errore del server in una frase leggibile.
 *
 * Il server manda stringhe fisse ("occupata", "altra lavanderia") proprio
 * perche' vengano riconosciute qui: sono un protocollo, non un messaggio. Non
 * cambiarle di la' senza cambiarle anche di qua.
 */
export function errMsg(e: any, lang: Lang) {
  const t = T[lang];
  const msg = String(e?.message ?? e ?? "");
  if (msg.includes("occupata") || msg.toLowerCase().includes("taken")) return t.taken(e?.by);
  if (msg.includes("altra lavanderia")) return t.altraLavanderia;
  return t.genericError;
}
