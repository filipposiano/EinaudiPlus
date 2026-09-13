// Audit log amministrativo — prima duplicato come chiamata rpc("admin_log", ...)
// in due punti (login/logout in admin/auth.js, mutazioni in admin/data.js),
// ognuno con la propria gestione degli errori. Un solo posto da cui passa,
// non due copie che possono divergere nel tempo.
//
// Sempre best-effort: chi chiama non aspetta che il log finisca prima di
// rispondere, e un log perso non deve mai far fallire l'azione vera.

import { rpc } from "../db/rpcClient.js";

export function logAdminAction({ actor, action, detail }) {
  return rpc("admin_log", { p_actor: actor, p_action: action, p_detail: detail || {} }).catch(() => {
    // il log non deve impedire la risposta né far fallire l'operazione
  });
}
