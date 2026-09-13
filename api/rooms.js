// Sostituisce Code.gs, che era deployato DUE volte (una per sala) su due
// spreadsheet distinti. Qui e' una funzione sola: la sala arriva come ?space=.
//
// Differenza dal client lavanderia: qui l'action viaggia nella query string e
// il corpo contiene solo i dati. Manteniamo quella convenzione perche' e'
// quella che il client gia' installato usa.
//
// Lettura, prenotazione e cancellazione passano ora dal modulo Common Spaces
// (src/modules/common-spaces) — vedi refactor-enterprise/ARCHITETTURA-ENTERPRISE.md.

import { readBody, json, fail, tokenOk, allow, methodOk } from "./_lib/http.js";
import { getBookings, bookSpace, clearBooking, SPACES } from "../src/modules/common-spaces/index.js";
import { AppError } from "../src/shared/errors/AppError.js";

export default async function handler(req, res) {
  if (!methodOk(req, res, ["GET", "POST"])) return;

  const body = req.method === "POST" ? readBody(req) : {};
  if (!tokenOk(req, body)) return fail(res, "unauthorized", {}, 401);

  const space = String(req.query.space || body.space || "").trim();
  if (!SPACES.has(space)) return fail(res, "sala non valida");

  try {
    if (req.method === "GET") {
      return json(res, 200, await getBookings(space));
    }

    if (!(await allow(req, "rooms", 40, 600))) {
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
  } catch (err) {
    // Un errore tipizzato dal modulo (validazione di giorno/orario): stesso
    // messaggio che il client leggeva già prima, non un dettaglio interno.
    // Qualunque altro errore resta dietro il messaggio neutro di sempre.
    if (err instanceof AppError && err.expose) {
      return fail(res, err.message, err.extra || {}, err.status);
    }
    console.error("[rooms]", err.rpc || "", err.message);
    return fail(res, "errore del server, riprova", {}, 500);
  }
}
