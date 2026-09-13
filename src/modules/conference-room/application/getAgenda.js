import { parseIntInRange } from "../../../shared/validation/number.js";
import { GIORNI_AGENDA_MIN, GIORNI_AGENDA_MAX, GIORNI_AGENDA_DEFAULT } from "../domain/rules.js";

// Fedele all'originale: un valore mancante O malformato ricade sul default
// (30 giorni), non viene rifiutato — è un endpoint di sola lettura per i
// residenti, non c'è nulla da proteggere scartando invece di ripiegare.
export async function getAgenda({ giorni }, { conferenceRepository }) {
  const parsed = parseIntInRange(giorni, GIORNI_AGENDA_MIN, GIORNI_AGENDA_MAX) ?? GIORNI_AGENDA_DEFAULT;
  return conferenceRepository.agenda(parsed);
}
