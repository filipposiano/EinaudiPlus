// Percorso pubblico della Grigliata — lettura dello stato e adesione dei
// residenti. Camera autodichiarata, stesso modello di fiducia di
// api/laundry.js e api/rooms.js: nessuna sessione richiesta.
//
// Il percorso amministrativo (creare l'evento, vedere chi ha aderito,
// confermare i pagamenti) passa da /api/admin/data, dove il cookie viene
// verificato — qui c'è solo quello che un residente può fare da solo.

import { readBody, json, fail, botFilterTokenOk, methodOk } from "./_lib/http.js";
import { checkRateLimit, clientIp } from "../src/shared/http/rateLimit.js";
import { getStatoPubblico, iscriviti, dichiaraPagamento } from "../src/modules/grigliata/index.js";
import { wrapHandler } from "../src/shared/errors/wrapHandler.js";

export default wrapHandler("grigliata", async (req, res) => {
  if (!methodOk(req, res, ["GET", "POST"])) return;

  const body = req.method === "POST" ? readBody(req) : {};

  if (!botFilterTokenOk(req, body)) return fail(res, "unauthorized", {}, 401);

  // ── Lettura ──────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    // Stesso tetto di laundry-read: largo apposta perché il collegio sta
    // dietro NAT (vedi la nota gemella in api/laundry.js) — qui serve solo
    // contro il rubinetto aperto, non contro l'uso normale.
    if (!(await checkRateLimit("grigliata-read", clientIp(req), 600, 600))) {
      return fail(res, "troppe richieste, riprova fra poco", {}, 429);
    }
    const room = (req.query.room || "").toString().trim();
    return json(res, 200, await getStatoPubblico(room));
  }

  // ── Scrittura ────────────────────────────────────────────────────────────
  const action = String(body.action || "");
  const room = String(body.room ?? "").trim();

  if (!(await checkRateLimit("grigliata", clientIp(req), 30, 600))) {
    return fail(res, "troppe richieste, riprova fra poco", {}, 429);
  }

  switch (action) {
    case "iscrivi":
      return json(res, 200, await iscriviti(room, body.menu));

    case "dichiaraPagamento":
      return json(res, 200, await dichiaraPagamento(room));

    default:
      return fail(res, "azione sconosciuta");
  }
});
