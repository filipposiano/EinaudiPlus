// Use-case: cancella una prenotazione di sala per id (pannello admin).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { ID_MIN, ID_MAX } from "../domain/spaces.js";

export async function adminDeleteSpaceBooking({ id }, { commonSpacesRepository }) {
  const parsedId = parseIntInRange(id, ID_MIN, ID_MAX);
  if (parsedId === null) throw new ValidationError('campo "id" non valido');
  return commonSpacesRepository.adminDelete({ id: parsedId });
}
