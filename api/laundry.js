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
import { readBody, json, fail, tokenOk, allow, methodOk } from "./_lib/http.js";

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

    switch (action) {
      case "book":
        return json(res, 200, await rpc("book_laundry", {
          p_room: room,
          p_day: Number(body.day),
          p_slot: Number(body.slot),
          p_machine: String(body.machine || ""),
        }));

      case "clear":
        return json(res, 200, await rpc("clear_laundry", {
          p_room: room || null,
          p_day: Number(body.day),
          p_slot: Number(body.slot),
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
        return json(res, 200, await rpc("upsert_push_sub", {
          p_room: room,
          p_endpoint: String(sub.endpoint || ""),
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
