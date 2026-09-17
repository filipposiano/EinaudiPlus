// Policy di autorizzazione del modulo Linen Change — stesso principio di
// identity/domain/roles.js, laundry/domain/policy.js e theme/domain/policy.js.
//
// A differenza del tema stagionale (sistemista soltanto, perché è
// un'estetica che riguarda l'intera app), il cambio biancheria resta una
// decisione operativa di portineria: FDO e sistemista la impostano, lo staff
// no — la stessa distinzione che laundry/domain/policy.js applica a
// setMachineStatus, e per lo stesso motivo (vedi VIETATE_A_STAFF lì: "lo
// staff prenota e libera turni per conto della Direzione come l'FDO, ma non
// tocca" le decisioni operative della lavanderia). Il delegato nemmeno: i
// suoi permessi stanno per intero nel modulo Grigliata.

import { isStaff, isDelegato } from "../../identity/index.js";

const AZIONI_LINEN_CHANGE = new Set(["cambioBiancheriaGet", "cambioBiancheriaSet", "cambioBiancheriaSkip"]);

/**
 * Decide se `claims` può eseguire `action`.
 *
 * Torna `null` quando l'azione non appartiene a questo modulo.
 */
export function authorize(claims, action) {
  if (!AZIONI_LINEN_CHANGE.has(action)) return null;
  if (!claims) return false;
  return !isStaff(claims) && !isDelegato(claims);
}
