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

import { rpc } from "./_lib/db.js";
import { readBody, json, fail, tokenOk, allow, methodOk, intero, camera } from "./_lib/http.js";
import { endpointAllowed } from "./_lib/push.js";

// 19 turni al giorno, 7 giorni. Il numero vero sta in laundry.n_slots e lo
// ricontrolla il database: qui serve solo un limite superiore per scartare
// l'assurdo prima di fare il giro.
const MAX_SLOT = 18;

export default async function handler(req, res) {
  if (!methodOk(req, res, ["GET", "POST"])) return;

  const body = req.method === "POST" ? readBody(req) : {};

  if (!tokenOk(req, body)) return fail(res, "unauthorized", {}, 401);

  try {
    // ── Lettura ──────────────────────────────────────────────────────────────
    if (req.method === "GET") {
      const room = (req.query.room || "").toString().trim();
      // Senza camera si ricade sulla lavanderia principale, come faceva
      // getApiUrl() con il suo "return API_URL".
      return json(res, 200, await rpc("laundry_snapshot", { p_room: room || null }));
    }

    // ── Scrittura ────────────────────────────────────────────────────────────
    const action = String(body.action || "");
    const room = String(body.room ?? "").trim();

    if (!(await allow(req, "laundry", 60, 600))) {
      return fail(res, "troppe richieste, riprova fra poco", {}, 429);
    }

    // day e slot valgono per book e clear: si validano una volta sola.
    const day  = intero(body.day, 0, 6);
    const slot = intero(body.slot, 0, MAX_SLOT);
    if ((action === "book" || action === "clear") && (day === null || slot === null)) {
      return fail(res, "giorno o turno non valido");
    }

    switch (action) {
      case "book": {
        if (!camera(room)) return fail(res, "camera non valida");
        return json(res, 200, await rpc("book_laundry", {
          p_room: room,
          p_day: day,
          p_slot: slot,
          p_machine: String(body.machine || ""),
          // Da dove si sta agendo, distinto dall'intestatario: serve a impedire
          // che dalla Manica si prenoti una macchina del Valentino (e
          // viceversa). Assente nei client vecchi, e li' il controllo si
          // disattiva invece di rifiutare prenotazioni valide.
          p_actor_room: camera(body.actor_room),
        }));
      }

      case "clear":
        // `p_as_admin` NON si manda da qui, e non è una svista: questo è il
        // percorso pubblico e il valore di default nella funzione SQL è già
        // `false`. Ometterlo ha due effetti buoni: un client non può alzarsi i
        // poteri mandando un campo in più, e la chiamata funziona anche prima
        // che la migrazione 006 sia applicata — cioè non c'è una finestra in
        // cui il codice è online e il database ancora no.
        //
        // Chi ha una sessione amministrativa passa da /api/admin/data
        // (azione `clearDirezione`), dove il cookie viene verificato prima.
        return json(res, 200, await rpc("clear_laundry", {
          p_room: camera(room),
          p_day: day,
          p_slot: slot,
          p_machine: String(body.machine || ""),
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
        const endpoint = String(sub.endpoint || "");

        // Si accettano solo gli endpoint dei servizi push conosciuti.
        //
        // sendWebPush() li ricontrolla comunque prima di spedire, quindi non
        // c'era un rischio di SSRF: ma senza questo si poteva SCRIVERE in
        // push_sub qualunque stringa — provato in produzione con
        // `http://169.254.169.254/latest/meta-data`, l'indirizzo dei metadati
        // cloud, e la riga veniva salvata. Righe simili non sarebbero mai
        // state potate (la potatura scatta solo sul 404/410 di un servizio
        // vero) e restavano attaccate alla camera di chiunque.
        if (!endpointAllowed(endpoint)) {
          return fail(res, "endpoint di notifica non riconosciuto");
        }
        if (!camera(room)) return fail(res, "camera non valida");

        return json(res, 200, await rpc("upsert_push_sub", {
          p_room: room,
          p_endpoint: endpoint,
          p_p256dh: String(keys.p256dh || ""),
          p_auth: String(keys.auth || ""),
        }));
      }

      case "unsubscribe":
        return json(res, 200, await rpc("remove_push_sub", {
          p_endpoint: String(body.endpoint || ""),
        }));

      // Il codice da incollare al bot Telegram. Serve un codice e non basta la
      // camera: altrimenti chiunque potrebbe scrivere al bot "sono la 112" e
      // ricevere i promemoria di un altro.
      case "telegramCode":
        return json(res, 200, await rpc("telegram_create_code", { p_room: room }));

      case "feedback": {
        if (!(await allow(req, "feedback", 10, 86400))) {
          return fail(res, "hai gia' inviato molte segnalazioni oggi", {}, 429);
        }
        return json(res, 200, await rpc("add_feedback", {
          p_room: room,
          p_text: String(body.text || ""),
        }));
      }

      default:
        return fail(res, "azione sconosciuta");
    }
  } catch (err) {
    // Il dettaglio interno resta nei log, al client va un messaggio neutro.
    console.error("[laundry]", err.rpc || "", err.message);
    return fail(res, "errore del server, riprova", {}, 500);
  }
}
