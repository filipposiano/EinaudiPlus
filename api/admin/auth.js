// Login del pannello amministrativo.

import { readBody, json, clientIp, allow, methodOk } from "../_lib/http.js";
import {
  authenticate, issueToken, setSessionCookie, clearSessionCookie,
  currentAdmin, adminConfigured,
} from "../_lib/auth.js";
import { rpc } from "../_lib/db.js";

export default async function handler(req, res) {
  if (!methodOk(req, res, ["POST", "GET"])) return;

  // GET = "chi sono": serve al pannello per sapere se mostrare il login.
  if (req.method === "GET") {
    const me = currentAdmin(req);
    return json(res, 200, {
      ok: true, logged: Boolean(me), user: me?.u || null, role: me?.r || null,
    });
  }

  const body = readBody(req);
  const action = String(body.action || "login");

  if (action === "logout") {
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  if (!adminConfigured()) {
    return json(res, 500, { ok: false, error: "admin non configurato sul server" });
  }

  // Cinque tentativi ogni quarto d'ora per IP. Senza questo, una password
  // sola e condivisa e' attaccabile a forza bruta con tutta calma.
  if (!(await allow(req, "admin-login", 5, 900))) {
    return json(res, 429, { ok: false, error: "troppi tentativi, riprova fra un quarto d'ora" });
  }

  const username = String(body.username || "");
  const password = String(body.password || "");

  const role = authenticate(username, password);

  if (!role) {
    try {
      await rpc("admin_log", {
        p_actor: username || "(vuoto)",
        p_action: "login_fallito",
        p_detail: { ip: clientIp(req) },
      });
    } catch { /* il log non deve impedire la risposta */ }
    // Messaggio unico: non diciamo se ha sbagliato utente o password.
    return json(res, 401, { ok: false, error: "credenziali non valide" });
  }

  setSessionCookie(res, issueToken(username, role));
  try {
    await rpc("admin_log", { p_actor: username, p_action: "login", p_detail: { ip: clientIp(req), role } });
  } catch { /* idem */ }

  return json(res, 200, { ok: true, user: username, role });
}
