// Utilita' comuni a tutte le funzioni serverless.
//
// Rate limiting, validazione numerica e formato camera vivono ora nel
// kernel condiviso (src/shared/http/rateLimit.js, src/shared/validation/) —
// vedi refactor-enterprise/ARCHITETTURA-ENTERPRISE.md. Qui resta solo cio'
// che e' puramente HTTP e serve ancora a ogni endpoint.

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
 * Filtro anti-scanner, NON un controllo di sicurezza.
 *
 * Il valore atteso (env var APP_TOKEN) viene compilato dentro il bundle JS
 * pubblico (VITE_SECRET_TOKEN), quindi chiunque apra i devtools lo legge.
 * Il nome della funzione lo dice esplicitamente per non farlo scambiare in
 * futuro per una vera autorizzazione — quella la fanno la validazione lato
 * SQL e il rate limit di ogni endpoint, non questo controllo.
 *
 * (Il nome della variabile d'ambiente resta APP_TOKEN: è configurata su
 * Vercel, e rinominarla lì è un intervento operativo separato da questo.)
 */
export function botFilterTokenOk(req, body) {
  const expected = process.env.APP_TOKEN;
  if (!expected) return true; // non configurato: non blocchiamo nulla
  const got = (body && body.token) || (req.query && req.query.token) || "";
  return got === expected;
}

/** Applica i metodi ammessi, rispondendo 405 altrimenti. */
export function methodOk(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader("Allow", methods.join(", "));
  json(res, 405, { ok: false, error: "method-not-allowed" });
  return false;
}
