// Sala conferenze — sola lettura.
//
// Endpoint a sé e non dentro /api/rooms perché la sala conferenze non si
// prenota da qui: chi la programma passa da /api/admin/data, dove il cookie
// viene verificato. Tenere le due cose separate significa che questo file non
// ha nemmeno il codice per scrivere, e non c'è un ramo da proteggere.

import { rpc } from "./_lib/db.js";
import { json, fail, tokenOk, allow, methodOk, intero } from "./_lib/http.js";

export default async function handler(req, res) {
  if (!methodOk(req, res, ["GET"])) return;
  if (!tokenOk(req, {})) return fail(res, "unauthorized", {}, 401);

  if (!(await allow(req, "conferenze", 60, 600))) {
    return fail(res, "troppe richieste, riprova fra poco", {}, 429);
  }

  try {
    // Quanto avanti guardare. Il database lo limita comunque a 400 giorni:
    // qui si scarta solo l'assurdo prima di fare il giro.
    const giorni = intero(req.query.giorni, 1, 400) ?? 30;
    return json(res, 200, await rpc("conference_agenda", { p_giorni: giorni }));
  } catch (err) {
    console.error("[conferenze]", err.rpc || "", err.message);
    return fail(res, "errore del server, riprova", {}, 500);
  }
}
