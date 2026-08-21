// Sostituisce Code.gs, che era deployato DUE volte (una per sala) su due
// spreadsheet distinti. Qui e' una funzione sola: la sala arriva come ?space=.
//
// Differenza dal client lavanderia: qui l'action viaggia nella query string e
// il corpo contiene solo i dati. Manteniamo quella convenzione perche' e'
// quella che il client gia' installato usa.

import { rpc } from "./_lib/db.js";
import { readBody, json, fail, tokenOk, allow, methodOk, intero } from "./_lib/http.js";

const SPACES = new Set(["cinema", "music"]);

export default async function handler(req, res) {
  if (!methodOk(req, res, ["GET", "POST"])) return;

  const body = req.method === "POST" ? readBody(req) : {};
  if (!tokenOk(req, body)) return fail(res, "unauthorized", {}, 401);

  const space = String(req.query.space || body.space || "").trim();
  if (!SPACES.has(space)) return fail(res, "sala non valida");

  try {
    if (req.method === "GET") {
      return json(res, 200, await rpc("space_bookings", { p_slug: space }));
    }

    if (!(await allow(req, "rooms", 40, 600))) {
      return fail(res, "troppe richieste, riprova fra poco", {}, 429);
    }

    // L'action sta nella query; accettata anche nel corpo per tolleranza.
    const action = String(req.query.action || body.action || "");

    switch (action) {
      case "book": {
        // start sta dentro la giornata; end puo' arrivare a 2880 perche' una
        // fascia che scavalca la mezzanotte si esprime come "oltre le 24:00"
        // (vedi 004-oltre-mezzanotte). Il database ricontrolla comunque
        // durata e sovrapposizioni.
        const day   = intero(body.day, 0, 6);
        const start = intero(body.start, 0, 1439);
        const end   = intero(body.end, 1, 2880);
        if (day === null || start === null || end === null) {
          return fail(res, "giorno o orario non valido");
        }
        return json(res, 200, await rpc("book_space", {
          p_slug: space,
          p_day: day,
          p_start: start,
          p_end: end,
          p_name: String(body.name || ""),
          // `type` esiste solo per il cinema; per la musica il database lo ignora.
          p_type: body.type === "private" || body.type === "open" ? body.type : null,
        }));
      }

      // 'clear' e' la grafia usata dal client; 'delete' compariva nel refactor
      // non ancora integrato. Le accettiamo entrambe per non creare un bug
      // di allineamento quando quel lavoro rientrera'.
      case "clear":
      case "delete":
        return json(res, 200, await rpc("delete_space_booking", {
          p_slug: space,
          p_id: String(body.id || ""),
        }));

      default:
        return fail(res, "azione sconosciuta");
    }
  } catch (err) {
    console.error("[rooms]", err.rpc || "", err.message);
    return fail(res, "errore del server, riprova", {}, 500);
  }
}
