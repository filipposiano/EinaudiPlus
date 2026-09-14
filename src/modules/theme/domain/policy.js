// Policy di autorizzazione del modulo Theme — stesso principio di
// identity/domain/roles.js, laundry/domain/policy.js e
// common-spaces/domain/policy.js.
//
// Entrambe le azioni sono riservate al sistemista: il tema è una decisione
// che riguarda l'intera app, non qualcosa che la portineria o lo staff
// gestiscono giorno per giorno.

import { isSysadmin } from "../../identity/index.js";

const AZIONI_THEME = new Set(["temaGet", "temaSet"]);

/**
 * Decide se `claims` può eseguire `action`.
 *
 * Torna `null` quando l'azione non appartiene a questo modulo.
 */
export function authorize(claims, action) {
  if (!AZIONI_THEME.has(action)) return null;
  if (!claims) return false;
  return isSysadmin(claims);
}
