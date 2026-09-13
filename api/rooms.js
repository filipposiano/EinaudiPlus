// Sostituisce Code.gs, che era deployato DUE volte (una per sala) su due
// spreadsheet distinti. Qui e' una funzione sola: la sala arriva come ?space=.
//
// Differenza dal client lavanderia: qui l'action viaggia nella query string e
// il corpo contiene solo i dati. Manteniamo quella convenzione perche' e'
// quella che il client gia' installato usa.
//
// Lettura, prenotazione e cancellazione passano ora dal modulo Common Spaces
// (src/modules/common-spaces) — vedi refactor-enterprise/ARCHITETTURA-ENTERPRISE.md.
// wrapHandler centralizza error handling e logging (nessun cambio di
// comportamento nei percorsi esistenti: era già lo stesso pattern, solo
// duplicato a mano in ogni file).

import { readBody, json, fail, botFilterTokenOk, methodOk } from "./_lib/http.js";
import { checkRateLimit, clientIp } from "../src/shared/http/rateLimit.js";
import { getBookings, bookSpace, clearBooking, SPACES } from "../src/modules/common-spaces/index.js";
import { wrapHandler } from "../src/shared/errors/wrapHandler.js";

export default wrapHandler("rooms", async (req, res) => {
  if (!methodOk(req, res, ["GET", "POST"])) return;

  const body = req.method === "POST" ? readBody(req) : {};
  if (!botFilterTokenOk(req, body)) return fail(res, "unauthorized", {}, 401);

  const space = String(req.query.space || body.space || "").trim();
  if (!SPACES.has(space)) return fail(res, "sala non valida");

  if (req.method === "GET") {
    return json(res, 200, await getBookings(space));
  }

  if (!(await checkRateLimit("rooms", clientIp(req), 40, 600))) {
    return fail(res, "troppe richieste, riprova fra poco", {}, 429);
  }

  // L'action sta nella query; accettata anche nel corpo per tolleranza.
  const action = String(req.query.action || body.action || "");

  switch (action) {
    case "book":
      return json(res, 200, await bookSpace({
        space, day: body.day, start: body.start, end: body.end, name: body.name, type: body.type,
      }));

    // 'clear' e' la grafia usata dal client; 'delete' compariva nel refactor
    // non ancora integrato. Le accettiamo entrambe per non creare un bug
    // di allineamento quando quel lavoro rientrera'.
    case "clear":
    case "delete":
      return json(res, 200, await clearBooking({ space, id: body.id }));

    default:
      return fail(res, "azione sconosciuta");
  }
});
