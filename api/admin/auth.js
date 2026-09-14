// Login del pannello amministrativo.
//
// Autenticazione, sessioni, ruoli e account vivono ora in src/modules/identity
// (vedi refactor-enterprise/ARCHITETTURA-ENTERPRISE.md): qui resta solo
// l'istradamento HTTP — corpo, rate limit, audit log, risposta.
//
// wrapHandler() è una rete di sicurezza in più, non un cambio di
// comportamento: nessun percorso qui sotto lanciava eccezioni non gestite
// prima, ma un domani un'aggiunta distratta potrebbe farlo — con wrapHandler
// finirebbe comunque in un errore generico al client e nel log strutturato,
// mai in uno stack trace esposto.

import { readBody, json, methodOk } from "../_lib/http.js";
import { logAdminAction } from "../../src/shared/audit/auditLog.js";
import {
  authenticate, issueToken, setSessionCookie, clearSessionCookie,
  currentAdmin, adminConfigured, accountByUsername, sessioneAncoraValida,
} from "../../src/modules/identity/index.js";
import { checkRateLimit, clientIp } from "../../src/shared/http/rateLimit.js";
import { wrapHandler } from "../../src/shared/errors/wrapHandler.js";

export default wrapHandler("admin/auth", async (req, res) => {
  if (!methodOk(req, res, ["POST", "GET"])) return;

  // GET = "chi sono": serve al pannello per sapere se mostrare il login, e se
  // mostrare al suo posto la schermata di cambio password obbligato.
  if (req.method === "GET") {
    const me = currentAdmin(req);
    // Serve al pannello per decidere se mostrare la sala d'attesa. Non è
    // qui che l'obbligo viene imposto: quello lo fa data.js a ogni azione,
    // perché una schermata si aggira parlando all'API direttamente.
    let deveCambiare = false;
    let revocato = false;
    if (me) {
      try {
        const row = await accountByUsername(me.u);
        // Account disattivato o eliminato mentre il cookie era ancora in
        // giro: qui si risponde "non loggato" così il client si allinea da
        // solo (nasconde le sezioni, lascia l'identità DIREZIONE). Il
        // divieto vero resta su data.js, che rifiuta ogni azione: questa è
        // la cortesia che evita di mostrare un pannello che poi dà 401.
        if (!sessioneAncoraValida(row)) revocato = true;
        else deveCambiare = Boolean(row.deve_cambiare_password);
      } catch { /* se il database non risponde non si blocca comunque l'accesso */ }
    }
    if (revocato) clearSessionCookie(res);
    const attivo = Boolean(me) && !revocato;
    return json(res, 200, {
      ok: true, logged: attivo, user: attivo ? me.u : null, role: attivo ? me.r : null,
      deve_cambiare_password: deveCambiare,
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
  // sola e condivisa è attaccabile a forza bruta con tutta calma.
  if (!(await checkRateLimit("admin-login", clientIp(req), 5, 900))) {
    return json(res, 429, { ok: false, error: "troppi tentativi, riprova fra un quarto d'ora" });
  }

  const username = String(body.username || "");
  const password = String(body.password || "");

  const role = await authenticate(username, password);

  if (!role) {
    await logAdminAction({ actor: username || "(vuoto)", action: "login_fallito", detail: { ip: clientIp(req) } });
    // Messaggio unico: non diciamo se ha sbagliato utente o password.
    return json(res, 401, { ok: false, error: "credenziali non valide" });
  }

  setSessionCookie(res, issueToken(username, role));
  await logAdminAction({ actor: username, action: "login", detail: { ip: clientIp(req), role } });

  return json(res, 200, { ok: true, user: username, role });
});
