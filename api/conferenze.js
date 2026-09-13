// Sala conferenze — sola lettura.
//
// Endpoint a sé e non dentro /api/rooms perché la sala conferenze non si
// prenota da qui: chi la programma passa da /api/admin/data, dove il cookie
// viene verificato. Tenere le due cose separate significa che questo file non
// ha nemmeno il codice per scrivere, e non c'è un ramo da proteggere.
//
// Delega al modulo Conference Room — vedi refactor-enterprise/ARCHITETTURA-ENTERPRISE.md.

import { json, fail, botFilterTokenOk, methodOk } from "./_lib/http.js";
import { checkRateLimit, clientIp } from "../src/shared/http/rateLimit.js";
import { getAgenda } from "../src/modules/conference-room/index.js";
import { wrapHandler } from "../src/shared/errors/wrapHandler.js";

export default wrapHandler("conferenze", async (req, res) => {
  if (!methodOk(req, res, ["GET"])) return;
  if (!botFilterTokenOk(req, {})) return fail(res, "unauthorized", {}, 401);

  if (!(await checkRateLimit("conferenze", clientIp(req), 60, 600))) {
    return fail(res, "troppe richieste, riprova fra poco", {}, 429);
  }

  return json(res, 200, await getAgenda(req.query.giorni));
});
