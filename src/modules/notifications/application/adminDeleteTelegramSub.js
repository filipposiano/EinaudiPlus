import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";

const ID_MIN = 1, ID_MAX = Number.MAX_SAFE_INTEGER;

export async function adminDeleteTelegramSub({ id }, { notificationsRepository }) {
  const parsedId = parseIntInRange(id, ID_MIN, ID_MAX);
  if (parsedId === null) throw new ValidationError('campo "id" non valido');
  return notificationsRepository.adminDeleteTelegramSub({ id: parsedId });
}
