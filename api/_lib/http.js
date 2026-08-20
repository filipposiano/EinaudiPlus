// Utilita' comuni a tutte le funzioni serverless.

import { rpc } from "./db.js";

/**
 * Legge il corpo della richiesta.
 *
 * Il client manda Content-Type: text/plain anche quando il contenuto e' JSON.
 * Era un trucco per evitare il preflight CORS di Google Apps Script: ora non
 * servirebbe piu' (siamo same-origin), ma continuiamo ad accettarlo perche'
 * durante il cutover deve funzionare il client gia' installato sui telefoni,
 * che quel trucco lo usa ancora.
 */
export function readBody(req) {
  let body = req.body;

  if (body === undefined || body === null) return {};
  if (typeof body === "string") {
    if (!body.trim()) return {};
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      return {};
    }
  }
  return body;
}

export function json(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // Le risposte contengono lo stato delle prenotazioni: mai in cache.
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

/** Errore nella forma che il client gia' riconosce: { ok:false, error }. */
export function fail(res, error, extra = {}, status = 200) {
  return json(res, status, { ok: false, error, ...extra });
}

/**
 * Il token condiviso col frontend.
 *
 * Attenzione a cosa e': viene compilato dentro il bundle JS, quindi chiunque
 * apra i devtools lo legge. Non e' autorizzazione, e' un filtro contro gli
 * scanner automatici. Le difese vere sono la validazione lato SQL e il rate
 * limit qui sotto.
 */
export function tokenOk(req, body) {
  const expected = process.env.APP_TOKEN;
  if (!expected) return true; // non configurato: non blocchiamo nulla
  const got = (body && body.token) || (req.query && req.query.token) || "";
  return got === expected;
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Rate limit in Postgres. Torna true se la richiesta puo' procedere.
 * Se il database non risponde lasciamo passare: meglio un limite non applicato
 * che un'app che non prenota piu'.
 */
export async function allow(req, name, limit, windowSecs) {
  try {
    return await rpc("rl_hit", {
      p_bucket: `${name}:${clientIp(req)}`,
      p_limit: limit,
      p_window_secs: windowSecs,
    });
  } catch {
    return true;
  }
}

/** Applica i metodi ammessi, rispondendo 405 altrimenti. */
export function methodOk(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader("Allow", methods.join(", "));
  json(res, 405, { ok: false, error: "method-not-allowed" });
  return false;
}
