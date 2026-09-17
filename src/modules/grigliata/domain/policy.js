// Policy di autorizzazione del modulo Grigliata — stesso principio di
// identity/domain/roles.js e degli altri moduli.
//
// A differenza di ogni altro modulo del pannello, qui NON basta essere
// sistemista o un ruolo "generalista" (FDO/staff): queste quattro azioni
// sono riservate a chi organizza la grigliata (delegato) e al sistemista,
// che vede e può intervenire ovunque. FDO e staff restano fuori — non è
// affar loro quanto lo stato delle macchine non è affare del delegato (vedi
// la nota gemella in laundry/domain/policy.js).
//
// Le azioni dei RESIDENTI (stato pubblico, adesione, dichiarazione di
// pagamento) non passano da qui: sono pubbliche, autodichiarate come tutto
// il resto dell'app, servite da api/grigliata.js e non da api/admin/data.js
// — non hanno bisogno di una policy con un ruolo, perché non ne richiedono
// uno.

import { isSysadmin, isDelegato } from "../../identity/index.js";

const AZIONI_GRIGLIATA = new Set([
  "grigliataCrea", "grigliataOverview", "grigliataConfermaPagamento", "grigliataChiudi",
]);

/**
 * Decide se `claims` può eseguire `action`.
 *
 * Torna `null` quando l'azione non appartiene a questo modulo.
 */
export function authorize(claims, action) {
  if (!AZIONI_GRIGLIATA.has(action)) return null;
  if (!claims) return false;
  return isSysadmin(claims) || isDelegato(claims);
}
