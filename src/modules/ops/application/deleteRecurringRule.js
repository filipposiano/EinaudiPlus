// Toglie la regola, non le prenotazioni già create da essa: quelle restano
// finché la settimana non finisce, e si cancellano a mano.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";

const ID_MIN = 1, ID_MAX = Number.MAX_SAFE_INTEGER;

export async function deleteRecurringRule({ id }, { opsRepository }) {
  const parsedId = parseIntInRange(id, ID_MIN, ID_MAX);
  if (parsedId === null) throw new ValidationError('campo "id" non valido');
  return opsRepository.recurringDelete({ id: parsedId });
}
