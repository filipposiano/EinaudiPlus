// Policy di autorizzazione del modulo Ops — regole ricorrenti generiche
// (lavanderia E sala insieme, per questo trasversale), pulizia, conteggi,
// panoramica. Tutto riservato al sistemista tranne la panoramica, aperta a
// FDO e sistemista (non staff).

import { isStaff, isSysadmin, isDelegato } from "../../identity/index.js";

const AZIONI_OPS = new Set([
  "overview", "recurringList", "recurringSetActive", "recurringDelete",
  "applyRecurring", "purge", "counts",
]);

const SOLO_SISTEMISTA = new Set([
  "recurringList", "recurringSetActive", "recurringDelete", "applyRecurring", "purge", "counts",
]);

const VIETATE_A_STAFF = new Set(["overview"]);

export function authorize(claims, action) {
  if (!AZIONI_OPS.has(action)) return null;
  if (!claims) return false;
  if (SOLO_SISTEMISTA.has(action)) return isSysadmin(claims);
  // I permessi del delegato stanno per intero nel modulo Grigliata — vedi
  // la stessa riga in laundry/domain/policy.js. Le altre azioni sono già
  // SOLO_SISTEMISTA; solo "overview" ci arriverebbe altrimenti.
  if (isDelegato(claims)) return false;
  if (VIETATE_A_STAFF.has(action) && isStaff(claims)) return false;
  return true;
}
