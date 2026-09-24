// Policy di autorizzazione delle azioni amministrative di questo modulo —
// stesso principio di identity/domain/roles.js e laundry/domain/policy.js.
//
// isSysadmin() è un concetto di Identity, consumato qui tramite la sua
// superficie pubblica (index.js), non un file interno.

import { isSysadmin, isStaff, isDelegato } from "../../identity/index.js";

/** Azioni amministrative di dominio Common Spaces, riconosciute da authorize(). */
const AZIONI_COMMON_SPACES = new Set([
  "spaces", "deleteSpaceBooking", "bookSpaceDirezione", "recurringAddSpace", "spaceSetChiuso",
]);

/**
 * Le regole ricorrenti (create/sospendi/cancella/applica) sono riservate al
 * sistemista in tutto il pannello — qui vive solo la creazione, che è
 * l'unica azione specifica di questo dominio (le altre sono trasversali,
 * vedi index.js).
 */
const SOLO_SISTEMISTA = new Set(["recurringAddSpace"]);

/**
 * Chiudere/riaprire una sala (es. per il deposito dei pacchi) resta allo
 * stesso livello dello stato guasto/funzionante delle macchine: decisione
 * operativa di FDO e sistemista, non dello staff — stessa riga di
 * VIETATE_A_STAFF in laundry/domain/policy.js, per lo stesso motivo.
 */
const VIETATE_A_STAFF = new Set(["spaceSetChiuso"]);

/**
 * Decide se `claims` può eseguire `action`.
 *
 * Torna `null` quando l'azione non appartiene a questo modulo.
 */
export function authorize(claims, action) {
  if (!AZIONI_COMMON_SPACES.has(action)) return null;
  if (!claims) return false;
  if (SOLO_SISTEMISTA.has(action)) return isSysadmin(claims);
  // I permessi del delegato stanno per intero nel modulo Grigliata — vedi
  // la stessa riga in laundry/domain/policy.js.
  if (isDelegato(claims)) return false;
  if (VIETATE_A_STAFF.has(action) && isStaff(claims)) return false;
  return true;
}
