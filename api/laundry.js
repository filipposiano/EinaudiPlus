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
