// Tick dei promemoria, invocato da pg_cron dentro Supabase (una volta al minuto).
//
// Perche' non Vercel Cron: il piano Hobby limita i cron a UNA volta al giorno.
// pg_cron gira nel database, ha granularita' al minuto ed e' incluso nel free tier.
//
// La logica (raggruppamento, invio, report) vive ora nel modulo Notifications
// (src/modules/notifications) — vedi refactor-enterprise/ARCHITETTURA-ENTERPRISE.md.
// Qui resta solo l'istradamento: verifica del segreto, timing, risposta.

import { json, methodOk } from "./_lib/http.js";
import { sendDueReminders } from "../src/modules/notifications/index.js";
import { wrapHandler } from "../src/shared/errors/wrapHandler.js";
import { segretiCoincidono } from "../src/shared/crypto/constantTime.js";

export default wrapHandler("cron", async (req, res) => {
  if (!methodOk(req, res, ["POST", "GET"])) return;

  // Il segreto viaggia in header, non in query: le query string finiscono nei
  // log di accesso, gli header no.
  // Confronto a tempo costante: stesso gesto che identity/ usa gia' per le
  // password e per la firma dei token (vedi shared/crypto/constantTime.js).
  // Un CRON_SECRET non configurato continua a chiudere l'endpoint, non ad
  // aprirlo — se lo verifica segretiCoincidono() da sola.
  if (!segretiCoincidono(process.env.CRON_SECRET, req.headers["x-cron-secret"])) {
    return json(res, 401, { ok: false, error: "unauthorized" });
  }

  const started = Date.now();
  const result = await sendDueReminders(10);
  return json(res, 200, { ...result, ms: Date.now() - started });
}, { genericMessage: "tick fallito" });
