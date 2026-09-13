// Policy di autorizzazione del modulo Ops — regole ricorrenti generiche
// (lavanderia E sala insieme, per questo trasversale), pulizia, conteggi,
// panoramica. Tutto riservato al sistemista tranne la panoramica, aperta a
// FDO e sistemista (non staff).

import { isStaff, isSysadmin } from "../../identity/index.js";

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
  if (VIETATE_A_STAFF.has(action) && isStaff(claims)) return false;
  return true;
}
