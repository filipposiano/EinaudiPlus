// Use-case: cancella una prenotazione per id (pannello admin).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { ID_MIN, ID_MAX } from "../domain/slots.js";

export async function adminDeleteBooking({ id }, { laundryRepository }) {
  const parsedId = parseIntInRange(id, ID_MIN, ID_MAX);
  if (parsedId === null) throw new ValidationError('campo "id" non valido');
  return laundryRepository.deleteBooking({ id: parsedId });
}
