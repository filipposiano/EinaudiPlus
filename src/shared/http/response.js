// Helper di risposta HTTP condivisi — stessa forma già in uso in api/_lib/http.js,
// spostata qui perché è kernel, non logica di un dominio specifico.

export function json(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store"); // mai in cache: lo stato cambia in continuazione
  return res.status(status).json(payload);
}

/** Errore nella forma che il client già riconosce: { ok:false, error }. */
export function fail(res, error, extra = {}, status = 200) {
  return json(res, status, { ok: false, error, ...extra });
}

/** Legge il corpo della richiesta, tollerando testo/JSON/buffer (vedi api/_lib/http.js originale). */
export function readBody(req) {
  let body = req.body;
  if (body === undefined || body === null) return {};
  if (typeof body === "string") {
    if (!body.trim()) return {};
    try { return JSON.parse(body); } catch { return {}; }
  }
  if (Buffer.isBuffer(body)) {
    try { return JSON.parse(body.toString("utf8")); } catch { return {}; }
  }
  return body;
}

/** Applica i metodi ammessi, rispondendo 405 altrimenti. */
export function methodOk(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader("Allow", methods.join(", "));
  json(res, 405, { ok: false, error: "method-not-allowed" });
  return false;
}
