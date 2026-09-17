// Policy di autorizzazione del modulo Conference Room.
//
// La programmano solo gli amministratori "generalisti" (FDO, staff,
// sistemista) — i residenti la leggono da un endpoint pubblico a sé
// (getAgenda), che di scrivere non sa proprio. Il delegato no: i suoi
// permessi stanno per intero nel modulo Grigliata, vedi
// laundry/domain/policy.js per la stessa nota estesa.

import { isDelegato } from "../../identity/index.js";

const AZIONI_CONFERENCE = new Set([
  "conferenzaList", "conferenzaAdd", "conferenzaUpdate", "conferenzaSkip",
  "conferenzaMove", "conferenzaResetOccorrenza", "conferenzaDelete",
]);

export function authorize(claims, action) {
  if (!AZIONI_CONFERENCE.has(action)) return null;
  if (!claims) return false;
  return !isDelegato(claims);
}
