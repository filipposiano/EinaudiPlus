// Sostituisce laundry-Code.gs e new-laundry-Code.gs (due deployment Apps Script).
//
// Le due lavanderie qui sono una sola funzione: quale sia lo decide il database
// da laundry_for_room(), invece che il client scegliendo fra due URL diversi.
// Quella scelta lato client leggeva localStorage a ogni chiamata, quindi cambiando
// camera senza ricaricare si poteva leggere una lavanderia e scrivere sull'altra.
//
// Lo stile RPC (action nel corpo) e' mantenuto apposta: il client gia' installato
// sui telefoni parla questo linguaggio, e durante il cutover deve continuare a
// funzionare senza aggiornarsi.
//
// Ogni azione qui sotto delega ora al proprio modulo — Laundry, Notifications,
// Feedback, Bikes — vedi refactor-enterprise/ARCHITETTURA-ENTERPRISE.md. Questo
// file resta l'unico endpoint pubblico già legato a una camera, motivo per cui
// bici/notifiche/segnalazioni vivono ancora qui accanto alla lavanderia pur
// appartenendo ad altri domini.

import { readBody, json, fail, botFilterTokenOk, methodOk } from "./_lib/http.js";
import { checkRateLimit, clientIp } from "../src/shared/http/rateLimit.js";
import { getSnapshot, bookSlot, clearSlot } from "../src/modules/laundry/index.js";
import { subscribePush, unsubscribePush, createTelegramCode } from "../src/modules/notifications/index.js";
import { submitFeedback } from "../src/modules/feedback/index.js";
import { getBike, setBike } from "../src/modules/bikes/index.js";
import { wrapHandler } from "../src/shared/errors/wrapHandler.js";

export default wrapHandler("laundry", async (req, res) => {
  if (!methodOk(req, res, ["GET", "POST"])) return;

  const body = req.method === "POST" ? readBody(req) : {};

  if (!botFilterTokenOk(req, body)) return fail(res, "unauthorized", {}, 401);

  // ── Lettura ──────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    // Fino a ieri questo ramo usciva PRIMA di qualunque limite: la lettura
    // pubblica — cioe' l'endpoint piu' pesante dell'app, che monta l'intera
    // griglia settimanale — era l'unico senza tetto. /api/conferenze il suo
    // ce l'aveva gia': era una disparita', non una scelta.
    //
    // Il tetto e' alto apposta, e non protegge dallo scraping: l'intero
    // contenuto sta in una richiesta sola, quindi non c'e' ripetizione da
    // limitare (vedi la nota in fondo al file). Serve contro il rubinetto
    // aperto — chi martella per tenere occupata la funzione e il database.
    //
    // 600 ogni 10 minuti = una al secondo sostenuta da un singolo indirizzo.
    // Deve restare largo perche' il collegio sta dietro NAT: da qui centinaia
    // di residenti sono un client solo, e a fine turno le dashboard aperte si
    // ricaricano tutte insieme.
    if (!(await checkRateLimit("laundry-read", clientIp(req), 600, 600))) {
      return fail(res, "troppe richieste, riprova fra poco", {}, 429);
    }
    const room = (req.query.room || "").toString().trim();
    // Senza camera si ricade sulla lavanderia principale — invariato, decide
    // laundry_for_room() in SQL, non questo file.
    return json(res, 200, await getSnapshot(room));
  }

  // ── Scrittura ────────────────────────────────────────────────────────────
  const action = String(body.action || "");
  const room = String(body.room ?? "").trim();

  if (!(await checkRateLimit("laundry", clientIp(req), 60, 600))) {
    return fail(res, "troppe richieste, riprova fra poco", {}, 429);
  }

  switch (action) {
    case "book":
      return json(res, 200, await bookSlot({
        room, day: body.day, slot: body.slot, machine: body.machine, actorRoom: body.actor_room,
      }));

    case "clear":
      // Un secondo limite, più stretto, solo per la cancellazione.
      //
      // L'identità qui è autodichiarata — chiunque può dire "sono la 214" e
      // liberare il suo turno — ed è una scelta voluta: la lavanderia è un
      // posto fisico, fondato sulla fiducia fra chi ci abita. Ma "non
      // verifichiamo chi sei" e "accettiamo qualsiasi ritmo di distruzione"
      // sono due cose separabili, e questa riga separa la seconda dalla
      // prima. Col solo limite generale (60 richieste ogni 10 minuti) una
      // griglia settimanale intera — 7 giorni × 19 turni × 3 macchine, circa
      // 400 caselle — si svuota da un solo IP in poco più di un'ora.
      //
      // Quindici ogni dieci minuti è invisibile a un residente (cancella i
      // propri turni, due o tre al giorno) e divide per quattro il ritmo del
      // dispetto. Non è più stretto perché anche un amministratore passa di
      // qui: App.tsx usa il percorso amministrativo SOLO sui turni della
      // DIREZIONE, quindi una ripulita a mano sulla griglia arriva su questo
      // contatore, e non deve inciamparci.
      //
      // Non ferma chi ruota gli indirizzi: sposta la vandalizzazione da "due
      // minuti di noia" a "una cosa che devi volere davvero".
      if (!(await checkRateLimit("laundry-clear", clientIp(req), 15, 600))) {
        return fail(res, "troppe cancellazioni di fila, riprova fra poco", {}, 429);
      }
      // `p_as_admin` NON si manda da qui, e non è una svista: questo è il
      // percorso pubblico e il valore di default nella funzione SQL è già
      // `false` (vedi laundryRepository.clear() nel modulo). Chi ha una
      // sessione amministrativa passa da /api/admin/data (azione
      // `clearDirezione`), dove il cookie viene verificato prima.
      return json(res, 200, await clearSlot({
        room, day: body.day, slot: body.slot, machine: body.machine,
      }));

    // Il fuori servizio e' passato all'admin. Accettiamo entrambe le grafie
    // che il client ha usato nel tempo ('status' e 'setStatus') per dare un
    // messaggio chiaro invece del vecchio 'azione sconosciuta'.
    case "status":
    case "setStatus":
      return fail(res, "solo gli amministratori possono segnare una macchina fuori servizio", {}, 403);

    case "subscribe": {
      const sub = body.sub || {};
      const keys = sub.keys || {};
      return json(res, 200, await subscribePush({
        room, endpoint: String(sub.endpoint || ""), p256dh: keys.p256dh, auth: keys.auth,
      }));
    }

    case "unsubscribe":
      return json(res, 200, await unsubscribePush(String(body.endpoint || "")));

    // Il codice da incollare al bot Telegram. Serve un codice e non basta la
    // camera: altrimenti chiunque potrebbe scrivere al bot "sono la 112" e
    // ricevere i promemoria di un altro.
    case "telegramCode":
      return json(res, 200, await createTelegramCode(room));

    case "feedback": {
      if (!(await checkRateLimit("feedback", clientIp(req), 10, 86400))) {
        return fail(res, "hai gia' inviato molte segnalazioni oggi", {}, 429);
      }
      return json(res, 200, await submitFeedback(room, body.text));
    }

    // Se in camera c'è una bici. Letta e scritta dalle Impostazioni
    // dell'app, non ha niente a che fare con la lavanderia: vive qui solo
    // perché questo è l'unico endpoint pubblico già legato a una camera.
    case "bikeGet":
      return json(res, 200, await getBike(room));

    case "bikeSet":
      return json(res, 200, await setBike(room, body.has_bike));

    default:
      return fail(res, "azione sconosciuta");
  }
});

// ─── Nota: perche' qui non c'e' una difesa "anti-scraping" ───────────────────
//
// Tornera' in mente a qualcuno prima o poi, quindi meglio scriverlo.
//
// Un limite per IP non protegge questi dati, e non perche' sia tarato male:
// perche' non c'e' niente da limitare. Una GET sola restituisce la griglia
// settimanale INTERA — sette giorni per diciannove turni per tre macchine, con
// il numero di camera di chi ha prenotato. Due richieste (una per lavanderia)
// e chi copia ha finito. Non esiste soglia che distingua quelle due richieste
// dalle due che fa un residente aprendo l'app.
//
// L'esposizione e' voluta, non e' una falla: la schermata dice "chi ha le
// macchine in questo turno, e chi le aveva prima", ed e' il servizio che
// l'app rende. Ma vuol dire che la leva, se un giorno la si vuole, e' COSA
// torna da qui a chi non ha fatto accesso — non quanto spesso lo si chiede.
// Il limite qui sopra serve a un'altra cosa: che nessuno tenga il rubinetto
// aperto sulla funzione e sul database.
