// `data` è la data che la REGOLA produce (RECURRENCE-ID), non quella a cui
// l'incontro si vede: è il suo nome per sempre, anche dopo che è stato
// spostato. Mandare quella visibile creerebbe una seconda eccezione invece
// di correggere la prima.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { ID_MIN, ID_MAX } from "../domain/rules.js";

export async function skipOccurrence({ id, data, attore }, { conferenceRepository }) {
  const parsedId = parseIntInRange(id, ID_MIN, ID_MAX);
  if (parsedId === null) throw new ValidationError('campo "id" non valido');
  return conferenceRepository.skip({ id: parsedId, data: String(data || ""), attore });
}
