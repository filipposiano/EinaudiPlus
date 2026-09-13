import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";

const OFFSET_MIN = -52, OFFSET_MAX = 52;

export async function applyRecurringRules({ offset }, { opsRepository }) {
  const parsedOffset = offset === undefined || offset === null ? 0 : parseIntInRange(offset, OFFSET_MIN, OFFSET_MAX);
  if (parsedOffset === null) throw new ValidationError('campo "offset" non valido');
  return opsRepository.applyRecurring({ offset: parsedOffset });
}
