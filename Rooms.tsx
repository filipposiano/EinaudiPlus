// Rooms.tsx — Sale a FASCE ORARIE LIBERE (Cinema e Musica).
//
// Come gestiamo le fasce libere:
//  • il tempo è in MINUTI dalla mezzanotte; ogni prenotazione è un blocco [start,end);
//  • una TIMELINE giornaliera mostra a colpo d'occhio i blocchi occupati nella finestra
//    oraria della sala (0–24 per entrambe);
//  • due SELETTORI "Inizio/Fine" (step 30') generano il blocco; un controllo di
//    sovrapposizione (client + server) impedisce i conflitti;
//  • si vede solo la settimana corrente: le vecchie le pota il database.

import { useState, useEffect, useCallback } from "react";
import {
  Film, Music, X, Plus, Trash2, Info, Loader2, AlertTriangle,
} from "lucide-react";
import * as roomsApi from "./roomsApi";
import type { RoomKind, RoomBooking, CinemaType } from "./roomsApi";
import RuotaPicker from "./RuotaPicker";

// Le stesse sei lingue dell'app: il tipo arriva da i18n, cosi' non si puo'
// aggiungere una lingua di la' e dimenticarla di qua.
import type { Lang } from "./i18n";

const RED = "var(--primary)", RED_FG = "var(--primary-foreground)";
const OOS = "var(--destructive)";
const fg = "var(--foreground)", sub = "var(--muted-foreground)";
const surf = "var(--card)", div = "var(--border)", chip = "var(--secondary)";

// ─── Helpers tempo ──────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
const fmtMin = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const TODAY = (new Date().getDay() + 6) % 7; // 0 = Lunedì

// Finestra oraria e tipo per ciascuna sala
// `overnight`: se la sala si può tenere oltre la mezzanotte. Vero per
// entrambe: una prova che finisce all'una capita quanto una proiezione.
//
// Le due sale ora hanno la STESSA finestra, 0–24. La musica apriva alle 9 e
// chiudeva alle 23; il limite è stato tolto, e da lì in poi tenerle diverse
// non descriveva più niente — le regole di prenotazione della musica sono
// quelle del cinema. Resta diverso solo ciò che è davvero diverso: gli
// strumenti non in cuffia (STRUMENTI_DA/A più sotto), che è un vincolo sul
// rumore, non sull'apertura della sala.
//
// Nota: questi valori vivono solo qui. Le colonne open_min/close_min di
// room_space dicono le stesse ore ma non le applica nessuno — il database
// accetta qualunque fascia dentro le 24 ore.
const ROOM_CFG: Record<RoomKind, { winStart: number; winEnd: number; step: number; overnight: boolean }> = {
  cinema: { winStart: 0, winEnd: 24 * 60, step: 30, overnight: true },
  music:  { winStart: 0, winEnd: 24 * 60, step: 30, overnight: true },
};

function timeOptions(winStart: number, winEnd: number, step: number) {
  const out: number[] = [];
  for (let m = winStart; m <= winEnd; m += step) out.push(m);
  return out;
}

/**
 * Gli orari di fine selezionabili, dato un inizio.
 *
 * Prima erano gli stessi dell'inizio filtrati per `m > start`: da una sala che
 * chiude a mezzanotte, partendo alle 21:00, si poteva arrivare al massimo alle
 * 24:00. Per tenerla dalle 21 all'una bisognava fare due prenotazioni su due
 * giorni — e ricordarsi di farle entrambe.
 *
 * Ora la lista prosegue oltre la mezzanotte, fino a un massimo di 24 ore di
 * durata (il limite che il database applica comunque). I valori oltre le 24:00
 * restano espressi in minuti dall'inizio del giorno di partenza: 1500 = l'una
 * di notte del giorno dopo. È la stessa convenzione che il resto del file usa
 * già in `endOf()` per disegnare la timeline.
 */
function endOptions(start: number, cfg: { winEnd: number; step: number; overnight: boolean }) {
  const out: number[] = [];
  for (let m = start + cfg.step; m <= cfg.winEnd; m += cfg.step) out.push(m);
  if (!cfg.overnight) return out;
  // La coda riparte da dove finisce la griglia della sala, non da un 24:00
  // fisso. Oggi per entrambe le sale le due cose coincidono, ma la regola
  // scritta così regge anche una sala che chiudesse prima: partendo fisso da
  // 24:00, per una griglia che finisce alle 23:00 la lista saltava da 23:00 a
  // 00:30, perdendo per strada le 23:30 e la mezzanotte esatta.
  //
  // Si ferma prima di richiudere il cerchio sull'orario di partenza: una
  // prenotazione di 24 ore esatte non ha senso e il database la rifiuterebbe.
  for (let m = cfg.winEnd + cfg.step; m < start + 24 * 60; m += cfg.step) out.push(m);
  return out;
}

/**
 * L'orario di fine, dicendo a parole se cade il giorno dopo.
 *
 * Prima "(+1)", che è una notazione da tabella oraria: fuori da chi la conosce
 * già non vuol dire niente, e chi prenota la sala cinema non sta leggendo un
 * orario ferroviario.
 *
 * Poi "(domani)", che era sbagliato in un modo più insidioso: se oggi è
 * mercoledì e stai prenotando per venerdì sera, quella fascia finisce sabato,
 * non domani. "Domani" si misura da oggi; qui il riferimento è il giorno della
 * prenotazione. "(del giorno successivo)" lo dice senza ambiguità.
 */
const fmtEnd = (m: number, lang: Lang = "it") =>
  m > 24 * 60 ? `${fmtMin(m)} ${T[lang].giornoSuccessivo}`
  : m === 24 * 60 ? "24:00"
  : fmtMin(m);

// ─── i18n ─────────────────────────────────────────────────────────────────────
const T = {
  it: {
    cinema: "Sala Cinema", music: "Sala Musica",
    days: ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"],
    daysLong: ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"],
    rules: "Regole", close: "Chiudi",
    free: "Libera tutto il giorno", occupied: "Occupata",
    newBooking: "Nuova prenotazione",
    start: "Inizio", end: "Fine", name: "Nome", yourName: "Il tuo nome", roomLabel: "Stanza",
    type: "Tipo di proiezione", priv: "Privata", open: "Aperta a tutti",
    book: "Prenota blocco", cancel: "Annulla",
    bookings: "Prenotazioni del giorno", none: "Nessuna prenotazione",
    needName: "Inserisci un nome", badRange: "L'orario di fine deve essere dopo l'inizio",
    overlap: "Si sovrappone a una prenotazione esistente", booked: "Prenotato ✓",
    full: "Giorno pieno: massimo 6 prenotazioni.",
    deleted: "Prenotazione eliminata", errorGeneric: "Errore, riprova.",
    loading: "Carico…", retry: "Riprova", netError: "Impossibile contattare il server.",
    rulesTitle: "Regolamento", tipsTitle: "Problemi di connessione",
    musicNote: "Strumenti non in cuffia: consentiti solo 16:00–20:00.",
    overnightPart: "serata a cavallo della mezzanotte",
    resetToMyRoom: "↩ Ripristina la tua stanza",
    giornoSuccessivo: "(del giorno successivo)",
    aNomeDi: "A nome di",
    aNomeDiPlaceholder: "Es. Formazione PFP",
    formatoCamera: "Formato camera non valido!",
  },
  en: {
    cinema: "Cinema Room", music: "Music Room",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    daysLong: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    rules: "Rules", close: "Close",
    free: "Free all day", occupied: "Booked",
    newBooking: "New booking",
    start: "Start", end: "End", name: "Name", yourName: "Your name", roomLabel: "Room",
    type: "Screening type", priv: "Private", open: "Open to all",
    book: "Book block", cancel: "Cancel",
    bookings: "Bookings for the day", none: "No bookings",
    needName: "Enter a name", badRange: "End time must be after start",
    overlap: "Overlaps an existing booking", booked: "Booked ✓",
    full: "Day is full: max 6 bookings.",
    deleted: "Booking deleted", errorGeneric: "Error, try again.",
    loading: "Loading…", retry: "Retry", netError: "Couldn't reach the server.",
    rulesTitle: "Rules", tipsTitle: "Connection tips",
    musicNote: "Instruments without headphones: allowed only 16:00–20:00.",
    overnightPart: "overnight booking",
    resetToMyRoom: "↩ Reset to your room",
    giornoSuccessivo: "(the next day)",
    aNomeDi: "On behalf of",
    aNomeDiPlaceholder: "e.g. PFP Training",
    formatoCamera: "Invalid room format!",
  },
  fr: {
    cinema: "Salle Cinéma", music: "Salle Musique",
    days: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
    daysLong: ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"],
    rules: "Règles", close: "Fermer",
    free: "Libre toute la journée", occupied: "Réservée",
    newBooking: "Nouvelle réservation",
    start: "Début", end: "Fin", name: "Nom", yourName: "Ton nom", roomLabel: "Chambre",
    type: "Type de projection", priv: "Privée", open: "Ouverte à tous",
    book: "Réserver le créneau", cancel: "Annuler",
    bookings: "Réservations du jour", none: "Aucune réservation",
    needName: "Saisis un nom", badRange: "L'heure de fin doit être après le début",
    overlap: "Chevauche une réservation existante", booked: "Réservé ✓",
    full: "Journée complète : 6 réservations maximum.",
    deleted: "Réservation supprimée", errorGeneric: "Erreur, réessaie.",
    loading: "Chargement…", retry: "Réessayer", netError: "Impossible de joindre le serveur.",
    rulesTitle: "Règlement", tipsTitle: "Problèmes de connexion",
    musicNote: "Instruments sans casque : autorisés seulement de 16h00 à 20h00.",
    overnightPart: "soirée à cheval sur minuit",
    resetToMyRoom: "↩ Rétablir ta chambre",
    giornoSuccessivo: "(le lendemain)",
    aNomeDi: "Au nom de",
    aNomeDiPlaceholder: "Ex. Formation PFP",
    formatoCamera: "Format de chambre invalide !",
  },
  de: {
    cinema: "Kinoraum", music: "Musikraum",
    days: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
    daysLong: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
    rules: "Regeln", close: "Schließen",
    free: "Den ganzen Tag frei", occupied: "Belegt",
    newBooking: "Neue Buchung",
    start: "Beginn", end: "Ende", name: "Name", yourName: "Dein Name", roomLabel: "Zimmer",
    type: "Art der Vorführung", priv: "Privat", open: "Für alle offen",
    book: "Zeitblock buchen", cancel: "Abbrechen",
    bookings: "Buchungen des Tages", none: "Keine Buchungen",
    needName: "Gib einen Namen ein", badRange: "Das Ende muss nach dem Beginn liegen",
    overlap: "Überschneidet sich mit einer bestehenden Buchung", booked: "Gebucht ✓",
    full: "Tag ausgebucht: maximal 6 Buchungen.",
    deleted: "Buchung gelöscht", errorGeneric: "Fehler, versuch es nochmal.",
    loading: "Wird geladen…", retry: "Nochmal versuchen", netError: "Server nicht erreichbar.",
    rulesTitle: "Hausordnung", tipsTitle: "Verbindungsprobleme",
    musicNote: "Instrumente ohne Kopfhörer: nur von 16:00 bis 20:00 erlaubt.",
    overnightPart: "Abend über Mitternacht",
    resetToMyRoom: "↩ Dein Zimmer zurücksetzen",
    giornoSuccessivo: "(am Folgetag)",
    aNomeDi: "Im Namen von",
    aNomeDiPlaceholder: "z. B. PFP-Schulung",
    formatoCamera: "Ungültiges Zimmerformat!",
  },
  es: {
    cinema: "Sala de Cine", music: "Sala de Música",
    days: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
    daysLong: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"],
    rules: "Normas", close: "Cerrar",
    free: "Libre todo el día", occupied: "Reservada",
    newBooking: "Nueva reserva",
    start: "Inicio", end: "Fin", name: "Nombre", yourName: "Tu nombre", roomLabel: "Habitación",
    type: "Tipo de proyección", priv: "Privada", open: "Abierta a todos",
    book: "Reservar bloque", cancel: "Cancelar",
    bookings: "Reservas del día", none: "Ninguna reserva",
    needName: "Escribe un nombre", badRange: "La hora de fin debe ser posterior al inicio",
    overlap: "Se solapa con una reserva existente", booked: "Reservado ✓",
    full: "Día completo: máximo 6 reservas.",
    deleted: "Reserva eliminada", errorGeneric: "Error, inténtalo otra vez.",
    loading: "Cargando…", retry: "Reintentar", netError: "No se puede contactar con el servidor.",
    rulesTitle: "Reglamento", tipsTitle: "Problemas de conexión",
    musicNote: "Instrumentos sin auriculares: permitidos solo de 16:00 a 20:00.",
    overnightPart: "velada que pasa la medianoche",
    resetToMyRoom: "↩ Restablecer tu habitación",
    giornoSuccessivo: "(del día siguiente)",
    aNomeDi: "En nombre de",
    aNomeDiPlaceholder: "P. ej. Formación PFP",
    formatoCamera: "¡Formato de habitación no válido!",
  },
  nap: {
    cinema: "Sala Cinema", music: "Sala Musica",
    days: ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"],
    daysLong: ["Lunnerì", "Marterì", "Miercurì", "Gioverì", "Viernarì", "Sabbato", "Dummeneca"],
    rules: "Regole", close: "Chiure",
    free: "Libbera tutt''o juorno", occupied: "Occupata",
    newBooking: "Prenotazione nova",
    start: "Accumencia", end: "Fernesce", name: "Nomme", yourName: "'O nomme tuoio", roomLabel: "Cammera",
    type: "Tipo 'e proiezione", priv: "Privata", open: "Aperta a tuttu quante",
    book: "Prenòta", cancel: "Lassa sta'",
    bookings: "Prenotazioni d''a jurnata", none: "Nisciuna prenotazione",
    needName: "Miette nu nomme", badRange: "L'ora 'e fine adda sta' doppo chella 'e accummenciamento",
    overlap: "Se 'ntoppa cu n'ata prenotazione", booked: "Prenotato ✓",
    full: "Juorno chino: massimo 6 prenotazioni.",
    deleted: "Prenotazione levata", errorGeneric: "Errore, prova n'ata vota.",
    loading: "Sto' carrecanno…", retry: "Prova n'ata vota", netError: "Nun riesco a parla' cu 'o server.",
    rulesTitle: "Regulamento", tipsTitle: "Guaje 'e connessione",
    musicNote: "Strumenti senza cuffie: se ponno sunà sulo 'a 16:00 ê 20:00.",
    overnightPart: "serata ca passa 'a mezanotte",
    resetToMyRoom: "↩ Rimiette 'a cammera toia",
    giornoSuccessivo: "(o juorno appriesso)",
    aNomeDi: "A nomme 'e",
    aNomeDiPlaceholder: "Es. Formazione PFP",
    formatoCamera: "'O formato d''a cammera nun va buono!",
  },
} as const;

// ─── Testi regolamenti ──────────────────────────────────────────────────────
//
// Queste non sono stringhe d'interfaccia: sono le REGOLE DELLA CASA. La
// versione che vale resta quella italiana; le altre sono traduzioni di
// cortesia, per chi l'italiano non lo legge bene. Se la direzione cambia una
// regola, si cambia l'italiano e poi le traduzioni — mai il contrario.
//
// Vale anche per il napoletano, che prima qui non c'era e ricadeva
// sull'italiano: chi mette l'app in napoletano si trovava l'unica schermata di
// testo lungo in un'altra lingua. È una cortesia come le altre cinque — se
// c'è dubbio su cosa dice una regola, fa fede l'italiano.
type Regolamento = { rules: string[]; tips?: string[] };

const RULES: Record<RoomKind, Partial<Record<Lang, Regolamento>>> = {
  cinema: {
    it: {
      rules: [
        "La sala può essere prenotata in ogni momento.",
        "La sala è dotata di un proiettore (cavo HDMI già presente) e un impianto audio (collegabile via Bluetooth). Ricordatevi di portare il vostro PC.",
        "Chi prenota è responsabile di eventuali danni e della pulizia della sala.",
        "Per prenotare indicate l'orario in cui pensate di usarla, il vostro nome e se si tratta di uso personale o di una proiezione aperta a tutti (es. partite).",
        "Le prenotazioni si resettano ogni lunedì notte.",
      ],
      tips: [
        "Per connettere il PC al proiettore: accendete il proiettore con il telecomando, selezionate \"Source\" e scegliete HDMI 2 (dovrebbe connettersi automaticamente).",
        "Per connettere il PC all'impianto audio: attivate il bluetooth sul PC, accendete la soundbar, cliccate sul tasto del telecomando con il simbolo del Bluetooth (*). Sullo schermo della soundbar comparirà \"BT PAIRING\", a quel punto cercate la soundbar tra i dispositivi sul PC.",
      ],
    },
    en: {
      rules: [
        "You can reserve it when you want.",
        "In the TV room there is a projector (HDMI cable provided) and an audio system (Bluetooth connection). Remember to bring your PC.",
        "Whoever reserves the room is responsible for any damages and the cleaning of the room.",
        "To reserve, state the time, your name, and if it's for personal use or an open projection.",
        "The schedule resets every Monday night.",
      ],
      tips: [
        "To connect the PC to the projector: turn the projector on with the remote, select \"Source\" and choose HDMI 2 (it should connect automatically).",
        "To connect the PC to the audio system: enable Bluetooth on the PC, turn on the soundbar, press the remote button with the Bluetooth symbol (*). The soundbar shows \"BT PAIRING\", then look for the soundbar among the PC's devices.",
      ],
    },
    fr: {
      rules: [
        "La salle peut être réservée à tout moment.",
        "La salle dispose d'un vidéoprojecteur (câble HDMI déjà sur place) et d'une sono (connexion Bluetooth). Pensez à apporter votre ordinateur.",
        "La personne qui réserve est responsable des éventuels dégâts et du nettoyage de la salle.",
        "Pour réserver, indiquez l'horaire prévu, votre nom et s'il s'agit d'un usage personnel ou d'une projection ouverte à tous (ex. matchs).",
        "Les réservations sont remises à zéro chaque lundi dans la nuit.",
      ],
      tips: [
        "Pour connecter l'ordinateur au vidéoprojecteur : allumez-le avec la télécommande, appuyez sur « Source » et choisissez HDMI 2 (la connexion devrait se faire toute seule).",
        "Pour connecter l'ordinateur à la sono : activez le Bluetooth sur l'ordinateur, allumez la barre de son, appuyez sur la touche de la télécommande portant le symbole Bluetooth (*). L'écran affiche « BT PAIRING » : cherchez alors la barre de son parmi les appareils de l'ordinateur.",
      ],
    },
    de: {
      rules: [
        "Der Raum kann jederzeit gebucht werden.",
        "Der Raum ist mit einem Beamer (HDMI-Kabel liegt bereit) und einer Audioanlage (per Bluetooth) ausgestattet. Denkt daran, euren Laptop mitzubringen.",
        "Wer bucht, haftet für eventuelle Schäden und für die Sauberkeit des Raums.",
        "Gebt bei der Buchung die geplante Uhrzeit an, euren Namen und ob es sich um private Nutzung oder um eine für alle offene Vorführung handelt (z. B. Spiele).",
        "Die Buchungen werden jeden Montag in der Nacht zurückgesetzt.",
      ],
      tips: [
        "Laptop an den Beamer anschließen: Beamer mit der Fernbedienung einschalten, „Source“ wählen und HDMI 2 auswählen (die Verbindung sollte automatisch zustande kommen).",
        "Laptop an die Audioanlage anschließen: Bluetooth am Laptop einschalten, die Soundbar einschalten, auf der Fernbedienung die Taste mit dem Bluetooth-Symbol (*) drücken. Im Display erscheint „BT PAIRING“; sucht dann die Soundbar unter den Geräten des Laptops.",
      ],
    },
    es: {
      rules: [
        "La sala se puede reservar en cualquier momento.",
        "La sala cuenta con un proyector (cable HDMI ya disponible) y un equipo de audio (conexión por Bluetooth). Acordaos de traer vuestro ordenador.",
        "Quien reserva es responsable de los posibles daños y de la limpieza de la sala.",
        "Para reservar indicad la hora prevista, vuestro nombre y si es para uso personal o para una proyección abierta a todos (p. ej. partidos).",
        "Las reservas se reinician cada lunes por la noche.",
      ],
      tips: [
        "Para conectar el ordenador al proyector: encended el proyector con el mando, pulsad «Source» y elegid HDMI 2 (debería conectarse automáticamente).",
        "Para conectar el ordenador al equipo de audio: activad el Bluetooth en el ordenador, encended la barra de sonido y pulsad en el mando la tecla con el símbolo de Bluetooth (*). En la pantalla aparecerá «BT PAIRING»; buscad entonces la barra entre los dispositivos del ordenador.",
      ],
    },
    nap: {
      rules: [
        "'A sala se pò prenotà a qualunque ora.",
        "Dint'â sala nce sta nu proiettore (cu 'o cavo HDMI già 'ncoppa) e n'impianto audio (s'attacca cu 'o Bluetooth). Arricurdateve 'e purtà 'o PC vuosto.",
        "Chi prenota risponne d''e danne e d''a pulizia d''a sala.",
        "Pe' prenotà, mettite l'ora ca pensate 'e ce sta', 'o nomme vuosto e si è pe' vuje sulo o si è na proiezione aperta a tuttu quante (pe' dì, 'e partite).",
        "'E prenotazioni se azzerano ogne lunnerì 'e notte.",
      ],
      tips: [
        "Pe' attaccà 'o PC ô proiettore: appicciate 'o proiettore c''o telecomando, scegliete \"Source\" e po' HDMI 2 (s'avess'a attaccà da sulo).",
        "Pe' attaccà 'o PC a l'impianto audio: appicciate 'o Bluetooth ncopp'ô PC, appicciate 'a soundbar, e ppo' schiaffate 'o tasto d''o telecomando c''o segno d''o Bluetooth (*). Ncopp'ô schermo d''a soundbar esce \"BT PAIRING\": a chillu punto cercate 'a soundbar 'nmiez'ê dispositive d''o PC.",
      ],
    },
  },
  music: {
    it: {
      rules: [
        "Potete prenotarla quando volete.",
        "Si può utilizzare a qualsiasi ora (ATTENZIONE: l'uso di strumenti NON in cuffia è consentito SOLO dalle 16:00 alle 20:00).",
        "Chi prenota è responsabile di eventuali danni e della pulizia della sala.",
        "Le prenotazioni si resettano ogni lunedì notte.",
      ],
    },
    en: {
      rules: [
        "You can reserve it whenever you want.",
        "It can be used at any hour (NOTE: using instruments NOT with headphones is allowed ONLY from 16:00 to 20:00).",
        "Whoever reserves the room is responsible for any damages and the cleaning of the room.",
        "The schedule resets every Monday night.",
      ],
    },
    fr: {
      rules: [
        "Vous pouvez la réserver quand vous voulez.",
        "Elle est utilisable à toute heure (ATTENTION : les instruments SANS casque ne sont autorisés QUE de 16h00 à 20h00).",
        "La personne qui réserve est responsable des éventuels dégâts et du nettoyage de la salle.",
        "Les réservations sont remises à zéro chaque lundi dans la nuit.",
      ],
    },
    de: {
      rules: [
        "Ihr könnt ihn buchen, wann ihr wollt.",
        "Zu jeder Uhrzeit nutzbar (ACHTUNG: Instrumente OHNE Kopfhörer sind NUR von 16:00 bis 20:00 Uhr erlaubt).",
        "Wer bucht, haftet für eventuelle Schäden und für die Sauberkeit des Raums.",
        "Die Buchungen werden jeden Montag in der Nacht zurückgesetzt.",
      ],
    },
    es: {
      rules: [
        "Podéis reservarla cuando queráis.",
        "Se puede usar a cualquier hora (ATENCIÓN: el uso de instrumentos SIN auriculares está permitido SOLO de 16:00 a 20:00).",
        "Quien reserva es responsable de los posibles daños y de la limpieza de la sala.",
        "Las reservas se reinician cada lunes por la noche.",
      ],
    },
    nap: {
      rules: [
        "'A putite prenotà quanno vulite.",
        "Se pò ausà a qualunque ora (ATTIENTE: 'e strumente SENZA cuffie se ponno sunà SULO 'a 16:00 ê 20:00).",
        "Chi prenota risponne d''e danne e d''a pulizia d''a sala.",
        "'E prenotazioni se azzerano ogne lunnerì 'e notte.",
      ],
    },
  },
};

// ─── Rules modal ──────────────────────────────────────────────────────────────
/** Il regolamento nella lingua richiesta, o in italiano se non c'è. */
const regolamentoPer = (room: RoomKind, lang: Lang): Regolamento =>
  RULES[room][lang] ?? RULES[room].it!;

function RulesModal({ room, lang, onClose }: { room: RoomKind; lang: Lang; onClose: () => void }) {
  const t = T[lang];
  const r = regolamentoPer(room, lang);
  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background: "rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div className="w-full rounded-t-3xl pb-8 max-h-[85%] overflow-y-auto" style={{ background: "var(--background)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 sticky top-0" style={{ background: "var(--background)" }}>
          <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }} />
          <div className="flex items-center justify-between">
            <p className="text-lg font-bold" style={{ color: fg }}>{room === "cinema" ? t.cinema : t.music} · {t.rulesTitle}</p>
            <button onClick={onClose} className="p-2 rounded-xl" style={{ color: sub, background: chip }}><X size={16} /></button>
          </div>
        </div>
        <div className="px-6">
          <ol className="flex flex-col gap-2.5">
            {r.rules.map((line, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 size-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono"
                  style={{ background: `color-mix(in srgb, var(--primary) 15%, transparent)`, color: RED }}>{i + 1}</span>
                <p className="text-sm leading-relaxed" style={{ color: fg }}>{line}</p>
              </li>
            ))}
          </ol>
          {r.tips && (
            <>
              <p className="text-[11px] font-mono tracking-widest uppercase mt-6 mb-2" style={{ color: sub }}>{t.tipsTitle}</p>
              <div className="flex flex-col gap-2.5">
                {r.tips.map((line, i) => (
                  <div key={i} className="flex gap-3 rounded-2xl p-3 border" style={{ background: surf, borderColor: div }}>
                    <Info size={15} className="shrink-0 mt-0.5" style={{ color: RED }} />
                    <p className="text-xs leading-relaxed" style={{ color: sub }}>{line}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Timeline giornaliera ──────────────────────────────────────────────────────
function Timeline({ room, bookings }: { room: RoomKind; bookings: RoomBooking[] }) {
  const { winStart, winEnd } = ROOM_CFG[room];
  // Fine "normalizzata": una fascia che termina a 00:00 (o oltre la mezzanotte)
  // arriva con end ≤ start → la trattiamo come +24h (00:00 = 24:00 = 1440).
  const endOf = (b: RoomBooking) => (b.end <= b.start ? b.end + 24 * 60 : b.end);
  // La timeline si estende fino a includere la prenotazione più "tarda",
  // così le fasce 23–00 (e oltre mezzanotte) restano sempre visibili.
  const spanEnd = bookings.reduce((mx, b) => Math.max(mx, endOf(b)), winEnd);
  const span = spanEnd - winStart;
  const pct = (m: number) => `${((m - winStart) / span) * 100}%`;
  // Un tick ogni 3 ore. Prima la musica ne aveva uno ogni 2, perché la sua
  // griglia copriva 14 ore invece di 24; ora che copre la giornata intera come
  // il cinema, lo stesso passo darebbe tredici etichette appiccicate.
  const stepH = 3;
  const ticks: number[] = [];
  for (let m = winStart; m <= spanEnd; m += stepH * 60) ticks.push(m);
  // 1440 = mezzanotte di fine giornata → mostrala come "24:00" sull'asse.
  const tickLabel = (m: number) => (m === 24 * 60 ? "24:00" : fmtMin(m));

  return (
    <div className="px-1 pt-1 pb-6">
      <div className="relative h-16 rounded-xl overflow-hidden" style={{ background: chip }}>
        {/* linee guida orarie */}
        {ticks.map((m) => (
          <div key={"g" + m} className="absolute top-0 bottom-0 w-px"
            style={{ left: pct(m), background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }} />
        ))}
        {bookings.map((b) => {
          const open = b.type === "open";
          const left = Math.max(b.start, winStart);
          const right = Math.min(endOf(b), spanEnd);
          return (
            <div key={b.id} className="absolute top-0 bottom-0 flex flex-col items-center justify-center overflow-hidden px-1 gap-0.5"
              title={`${b.name} · ${fmtMin(b.start)}–${fmtMin(b.end)}`}
              style={{
                left: pct(left), width: `${((right - left) / span) * 100}%`, minWidth: "10px",
                background: open ? `color-mix(in srgb, ${RED} 82%, transparent)` : `color-mix(in srgb, ${OOS} 72%, transparent)`,
                borderLeft: "1px solid var(--background)",
              }}>
              <span className="text-[11px] font-semibold leading-none truncate w-full text-center" style={{ color: "#fff" }}>{b.name}</span>
              <span className="text-[9px] font-mono leading-none truncate w-full text-center" style={{ color: "rgba(255,255,255,0.85)" }}>{fmtMin(b.start)}–{fmtMin(b.end)}</span>
            </div>
          );
        })}
      </div>
      <div className="relative h-5 mt-1.5">
        {ticks.map((m) => (
          <span key={m} className="absolute text-[10px] font-mono -translate-x-1/2" style={{ left: pct(m), color: sub }}>{tickLabel(m)}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Vista sala ────────────────────────────────────────────────────────────────
export default function RoomView({ room, lang, roomNumber }: { room: RoomKind; lang: Lang; roomNumber?: string | null }) {
  const t = T[lang];
  const cfg = ROOM_CFG[room];
  const opts = timeOptions(cfg.winStart, cfg.winEnd, cfg.step);

  // Le ore in cui si puo' COMINCIARE.
  //
  // Mai le 24:00: come istante sono gia' lo zero del giorno dopo, e per il
  // cinema comparirebbero due volte nella stessa tendina.
  //
  // Per una sala che non scavalca si toglie anche l'ultima ora utile, perche'
  // cominciare all'orario di chiusura non lascerebbe nessuna fine possibile.
  // Da quando la musica scavalca, invece, una fine c'e' sempre: tenere fuori
  // le 23:00 rendeva prenotabile 22:30->05:00 ma non 23:00->01:00, che e'
  // l'esempio tipico di serata a cavallo della mezzanotte.
  const startOpts = (cfg.overnight ? opts : opts.slice(0, -1)).filter((m) => m < 24 * 60);
  const myRoom = (roomNumber || "").trim();   // identità = numero camera (come lavanderia)

  // Chi amministra prenota come DIREZIONE, che non è una camera: qui il campo
  // diventa testo libero e chiede il nome dell'iniziativa invece del numero.
  const direzione = myRoom === "DIREZIONE";

  const [bookings, setBookings] = useState<RoomBooking[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [selDay, setSelDay]     = useState(TODAY);
  const [start, setStart]       = useState(room === "music" ? 16 * 60 : 18 * 60);
  const [end, setEnd]           = useState(room === "music" ? 18 * 60 : 20 * 60);
  const [name, setName]         = useState("");
  const [ctype, setCtype]       = useState<CinemaType>("private");
  const [toast, setToast]       = useState<string | null>(null);
  const [toastUndo, setToastUndo] = useState<(() => void) | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [busy, setBusy]         = useState(false);
  // Per la Direzione si parte vuoto, cosi' il segnaposto suggerisce cosa
  // scrivere; lasciandolo vuoto la prenotazione risulta comunque "DIREZIONE".
  const [bookingRoom, setBookingRoom] = useState(direzione ? "" : (myRoom || ""));

  // Gli strumenti non in cuffia si possono usare solo fra le 16 e le 20: la
  // fascia scelta ne esce se comincia prima delle 16 o finisce dopo le 20.
  const STRUMENTI_DA = 16 * 60, STRUMENTI_A = 20 * 60;
  const fuoriFasciaStrumenti = start < STRUMENTI_DA || end > STRUMENTI_A;

  // Spostando l'inizio oltre la fine, la fine lo segue di uno step invece di
  // restare su un valore che il selettore non offre più (il campo mostrava
  // ancora "20:00" con inizio alle 23:00, e si scopriva l'errore solo premendo
  // Prenota).
  useEffect(() => {
    setEnd((e) => (e > start ? e : Math.min(start + cfg.step, cfg.overnight ? start + 24 * 60 - cfg.step : cfg.winEnd)));
  }, [start, cfg.step, cfg.winEnd, cfg.overnight]);

  const refresh = useCallback(async () => {
    try { setBookings(await roomsApi.getRoomBookings(room)); setError(false); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [room]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);

  // Cambiando sala il modulo torna agli orari tipici di QUELLA sala.
  //
  // Ora che le due griglie sono identiche non serve piu' a evitare un orario
  // inesistente: serve a proporre l'ora giusta. Per la musica sono le 16–18,
  // dentro la fascia in cui gli strumenti non in cuffia sono ammessi; per il
  // cinema le 18–20, che e' quando si guarda un film. Sono suggerimenti, non
  // limiti: da entrambe le ruote si raggiunge qualunque ora del giorno.
  useEffect(() => {
    setStart(room === "music" ? 16 * 60 : 18 * 60);
    setEnd(room === "music" ? 18 * 60 : 20 * 60);
  }, [room]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => { setToast(null); setToastUndo(null); }, 2500); return () => clearTimeout(id); }, [toast]);

  const dayBookings = bookings.filter((b) => b.day === selDay).sort((a, b) => a.start - b.start);

  // Le fasce di fine dipendono dall'inizio, quindi la lista cambia sotto i
  // piedi alla ruota: si calcola qui una volta sola, e serve anche per sapere
  // su quale riga posizionarla.
  const endOpts = endOptions(start, cfg);
  const iEnd = Math.max(0, endOpts.indexOf(end));
  const iStart = Math.max(0, startOpts.indexOf(start));

  async function submit() {
    const who = myRoom ? (bookingRoom.trim() || myRoom) : name.trim();
    if (!who) { setToast(t.needName); return; }

    // Il formato camera si controlla solo a chi UNA camera ce l'ha.
    //
    // La Direzione non è una camera: prenota per la struttura, e quello che
    // scrive è il nome dell'iniziativa — "Formazione PFP", "Assemblea", una
    // proiezione aperta. Prima passava di qui e si beccava "Formato camera non
    // valido" su "DIREZIONE" stesso, quindi non poteva prenotare le sale
    // affatto. Il database accetta già testo libero fino a 40 caratteri.
    //
    // `myRoom &&`: senza, lo stesso controllo scattava anche per chi non ha
    // NESSUNA camera (prenotazione anonima, "Continua senza accedere") — li'
    // `who` è il nome scritto a mano, non un numero, e il regex lo respingeva
    // sempre a meno che non fosse fatto di sole cifre.
    if (myRoom && !direzione) {
      const regexCamera = /^\d+(?:-?[a-bA-B])?$/;
      if (!regexCamera.test(who)) {
        setToast(t.formatoCamera); return;
      }
    }

    if (end <= start) { setToast(t.badRange); return; }

    // Una fascia che scavalca la mezzanotte occupa due giorni, e vanno
    // controllati entrambi: il server li divide comunque in due righe, ma
    // scoprirlo dopo il giro di rete è peggio che dirlo subito.
    //
    // Tranne la notte fra domenica e lunedì: quella coda cade sul lunedì della
    // settimana SEGUENTE, e `bookings` contiene solo la settimana corrente —
    // qui non c'è proprio niente contro cui confrontarla. Prima si controllava
    // `(selDay + 1) % 7`, che di domenica è il lunedì appena passato: una
    // prenotazione di lunedì mattina faceva rifiutare la serata di domenica
    // con "si sovrappone", parlando di ore che non c'entravano nulla. Meglio
    // nessun controllo che uno che guarda il giorno sbagliato — il vincolo del
    // database copre comunque il caso vero, e la risposta torna con "overlap".
    const sforo = end - 24 * 60;
    const codaControllabile = sforo > 0 && selDay < 6;
    const collide =
      roomsApi.hasOverlap(bookings, selDay, start, Math.min(end, 24 * 60)) ||
      (codaControllabile && roomsApi.hasOverlap(bookings, selDay + 1, 0, sforo));
    if (collide) { setToast(t.overlap); return; }
    setBusy(true);
    const prevIds = new Set(bookings.map((b) => b.id));
    try {
      const payload: Omit<RoomBooking, "id"> = room === "cinema"
        ? { day: selDay, start, end, name: who, type: ctype }
        : { day: selDay, start, end, name: who };
      const updated = await roomsApi.bookRoom(room, payload);
      setBookings(updated);
      if (direzione) setBookingRoom("");
      else if (myRoom) setBookingRoom(myRoom);
      else setName("");
      setToast(t.booked);
      // Una fascia che scavalca la mezzanotte crea due righe con lo stesso
      // group_id: basta l'id di una, remove() segue gia' il gruppo.
      const newId = updated.find((b) => !prevIds.has(b.id))?.id;
      setToastUndo(newId ? () => () => remove(newId) : null);
    } catch (e: any) {
      const msg = String(e?.message);
      setToast(msg === "overlap" ? t.overlap : msg === "full" ? t.full : t.errorGeneric);
      setToastUndo(null);
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    try { setBookings(await roomsApi.clearRoomBooking(room, id)); setToast(t.deleted); setToastUndo(null); }
    catch { setToast(t.errorGeneric); setToastUndo(null); }
  }

  const Icon = room === "cinema" ? Film : Music;

  if (loading) {
    return <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: sub }}>
      <Loader2 size={26} className="animate-spin-slow" style={{ color: RED }} /><p className="text-sm">{t.loading}</p>
    </div>;
  }
  if (error) {
    return <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center" style={{ color: sub }}>
      <AlertTriangle size={26} style={{ color: OOS }} /><p className="text-sm">{t.netError}</p>
      <button onClick={() => { setLoading(true); refresh(); }} className="rounded-xl px-4 py-2 text-sm font-semibold" style={{ background: RED, color: RED_FG }}>{t.retry}</button>
    </div>;
  }

  return (
    <div className="flex flex-col h-full md:max-w-4xl md:mx-auto md:w-full">
      {rulesOpen && <RulesModal room={room} lang={lang} onClose={() => setRulesOpen(false)} />}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-toast-in">
          <div className="flex items-center gap-2.5 rounded-2xl px-4 py-3 shadow-2xl border text-sm font-medium" style={{ background: surf, borderColor: div, color: fg }}>
            <span>{toast}</span>
            {toastUndo && (
              <button
                onClick={() => { toastUndo(); setToast(null); }}
                className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-lg"
                style={{ color: RED }}
              >
                {t.cancel}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6">
        {/* Intestazione sala */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl" style={{ background: `color-mix(in srgb, var(--primary) 15%, transparent)`, color: RED }}><Icon size={18} /></div>
            <h2 className="text-base font-bold" style={{ color: fg }}>{room === "cinema" ? t.cinema : t.music}</h2>
          </div>
          <button onClick={() => setRulesOpen(true)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold border transition-all active:scale-95"
            style={{ background: chip, borderColor: div, color: fg }}>
            <Info size={14} />{t.rules}
          </button>
        </div>

        {/* Selettore giorni */}
        <div className="grid grid-cols-7 gap-1 mb-3">
          {t.days.map((d, i) => {
            const active = i === selDay;
            return (
              <button key={d} onClick={() => setSelDay(i)} className="flex flex-col items-center py-1.5 rounded-xl transition-colors"
                style={{ background: active ? RED : "transparent", color: active ? RED_FG : sub }}>
                <span className="text-[9px] font-mono uppercase">{d}</span>
              </button>
            );
          })}
        </div>

        {/* Timeline occupazione */}
        <Timeline room={room} bookings={dayBookings} />

        {/* Form nuova prenotazione */}
        <div className="rounded-2xl border p-4 mb-4" style={{ background: surf, borderColor: div }}>
          <p className="text-[11px] font-mono tracking-widest uppercase mb-3" style={{ color: sub }}>{t.newBooking}</p>

          {/* Le stesse ruote del turno preferito, al posto di due tendine.
              Una tendina nativa, su parecchi telefoni, si apre come pannello di
              sistema ancorato al fondo dello schermo: dentro un foglio che
              scorre finisce sotto il bordo, ed e' il difetto che le ruote hanno
              gia' risolto in lavanderia e in sala polivalente. In piu' qui le
              voci sono tante — la fine, per una serata che scavalca, arriva a
              una quarantina — e scorrerle con lo snap e' piu' rapido che
              trascinare una tendina lunga quanto lo schermo.

              Le etichette restano corte ("00:30", non "00:30 (del giorno
              successivo)"): a 34px di riga non ci starebbero, e la frase per
              esteso si legge comunque due volte piu' sotto — nella riga qui
              sotto e sul pulsante di conferma. Dentro una stessa lista un
              orario non si ripete mai, quindi la forma breve non e' ambigua. */}
          <div className="flex gap-3 mb-1">
            <label className="flex-1 min-w-0">
              <span className="text-[11px]" style={{ color: sub }}>{t.start}</span>
              <div className="mt-1">
                <RuotaPicker
                  key={`inizio-${room}`}
                  valori={startOpts.map((m) => fmtMin(m))}
                  indice={iStart}
                  onCambia={(i) => setStart(startOpts[i])}
                  ariaLabel={t.start}
                />
              </div>
            </label>
            <label className="flex-1 min-w-0">
              <span className="text-[11px]" style={{ color: sub }}>{t.end}</span>
              <div className="mt-1">
                {/* `key` legata a sala e inizio: la ruota non si lascia
                    pilotare da fuori (vedi RuotaPicker, il ciclo
                    scorrimento->indice), e quando cambia l'uno o l'altro
                    cambiano sia la lista sia la riga scelta. Rimontarla e' il
                    modo previsto per riallinearla. */}
                <RuotaPicker
                  key={`fine-${room}-${start}`}
                  valori={endOpts.map((m) => (m === 24 * 60 ? "24:00" : fmtMin(m)))}
                  indice={iEnd}
                  onCambia={(i) => setEnd(endOpts[i])}
                  ariaLabel={t.end}
                />
              </div>
            </label>
          </div>

          {/* Detto a parole solo quando serve davvero. */}
          <p className="text-[11px] mb-3 h-4" style={{ color: sub }}>
            {end > 24 * 60 ? `${t.end}: ${fmtEnd(end, lang)}` : ""}
          </p>

          {direzione ? (
            /* Testo libero, non maiuscolo e non monospaziato: qui non si scrive
               un codice ma il nome di una cosa che succede — "Formazione PFP",
               "Assemblea di sezione". È quello che comparirà sulla timeline a
               chi guarda la sala. */
            <label className="block mb-3">
              <span className="text-[11px]" style={{ color: sub }}>{t.aNomeDi}</span>
              <input value={bookingRoom} maxLength={40}
                onChange={(e) => setBookingRoom(e.target.value)}
                placeholder={t.aNomeDiPlaceholder}
                className="w-full mt-1 rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ background: chip, color: fg, border: `1px solid ${div}` }} />
            </label>
          ) : myRoom ? (
            <label className="block mb-3">
              <span className="text-[11px]" style={{ color: sub }}>{t.roomLabel}</span>
              <input value={bookingRoom} onChange={(e) => setBookingRoom(e.target.value.toUpperCase())} placeholder={myRoom}
                className="w-full mt-1 rounded-xl px-3 py-2.5 text-sm font-mono outline-none"
                style={{ background: chip, color: fg, border: `1px solid ${div}` }} />
              {bookingRoom !== myRoom && (
                <button onClick={() => setBookingRoom(myRoom)} className="text-[10px] mt-1" style={{ color: sub }}>
                  {t.resetToMyRoom}
                </button>
              )}
            </label>
          ) : (
            <label className="block mb-3">
              <span className="text-[11px]" style={{ color: sub }}>{t.name}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.yourName}
                className="w-full mt-1 rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ background: chip, color: fg, border: `1px solid ${div}` }} />
            </label>
          )}

          {room === "cinema" && (
            <div className="mb-3">
              <span className="text-[11px]" style={{ color: sub }}>{t.type}</span>
              <div className="flex gap-2 mt-1">
                {([["private", t.priv], ["open", t.open]] as [CinemaType, string][]).map(([val, label]) => (
                  <button key={val} onClick={() => setCtype(val)}
                    className="flex-1 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all active:scale-95 border"
                    style={ctype === val
                      ? { background: RED, color: RED_FG, borderColor: RED }
                      : { background: chip, color: fg, borderColor: div }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* L'avviso compare solo se la fascia scelta esce davvero da
              16:00–20:00. Stampandolo sempre diventava arredamento: chi
              prenotava dentro la fascia lo leggeva per settimane senza che lo
              riguardasse, e chi ne usciva non lo notava piu'. */}
          {room === "music" && fuoriFasciaStrumenti && (
            <p className="text-[11px] mb-3 flex items-start gap-1.5" style={{ color: "var(--status-prev-text)" }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              {t.musicNote}
            </p>
          )}

          <button onClick={submit} disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
            style={{ background: RED, color: RED_FG, opacity: busy ? 0.6 : 1 }}>
            <Plus size={15} />{t.book} · {fmtMin(start)}–{fmtEnd(end, lang)}
          </button>
        </div>

        {/* Prenotazioni del giorno */}
        <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color: sub }}>
          {t.bookings} · {t.daysLong[selDay]}
        </p>
        <div className="rounded-2xl overflow-hidden border" style={{ background: surf, borderColor: div }}>
          {dayBookings.length === 0 ? (
            <div className="px-4 py-4 text-center"><p className="text-xs" style={{ color: sub }}>{t.none}</p></div>
          ) : (
            dayBookings.map((b, i) => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: i < dayBookings.length - 1 ? `1px solid ${div}` : "none" }}>
                <div className="w-px h-8 rounded-full shrink-0" style={{ background: b.type === "open" ? RED : (room === "cinema" ? OOS : RED) }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono font-bold" style={{ color: fg }}>{fmtMin(b.start)} – {fmtEnd(b.end, lang)}</p>
                  <p className="text-[11px] truncate" style={{ color: sub }}>
                    {b.name}{b.type ? ` · ${b.type === "open" ? t.open : t.priv}` : ""}
                    {/* Metà di una serata che scavalca la mezzanotte: senza
                        dirlo sembrerebbero due prenotazioni scollegate, e il
                        cestino su una cancella comunque tutte e due. */}
                    {b.group ? ` · ${t.overnightPart}` : ""}
                  </p>
                </div>
                <button onClick={() => remove(b.id)} aria-label={t.cancel}
                  className="p-2 rounded-lg shrink-0 transition-all active:scale-90"
                  style={{ background: `color-mix(in srgb, var(--destructive) 10%, transparent)`, color: OOS }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
