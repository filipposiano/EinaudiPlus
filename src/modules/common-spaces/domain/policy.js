// Policy di autorizzazione delle azioni amministrative di questo modulo —
// stesso principio di identity/domain/roles.js e laundry/domain/policy.js.
//
// isSysadmin() è un concetto di Identity, consumato qui tramite la sua
// superficie pubblica (index.js), non un file interno.

import { isSysadmin, isDelegato } from "../../identity/index.js";

/** Azioni amministrative di dominio Common Spaces, riconosciute da authorize(). */
const AZIONI_COMMON_SPACES = new Set([
  "spaces", "deleteSpaceBooking", "bookSpaceDirezione", "recurringAddSpace",
]);

/**
 * Le regole ricorrenti (create/sospendi/cancella/applica) sono riservate al
 * sistemista in tutto il pannello — qui vive solo la creazione, che è
 * l'unica azione specifica di questo dominio (le altre sono trasversali,
 * vedi index.js).
 */
const SOLO_SISTEMISTA = new Set(["recurringAddSpace"]);

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
  return true;
}
