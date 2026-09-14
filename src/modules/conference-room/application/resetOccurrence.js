import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { ID_MIN, ID_MAX } from "../domain/rules.js";

export async function resetOccurrence({ id, data }, { conferenceRepository }) {
  const parsedId = parseIntInRange(id, ID_MIN, ID_MAX);
  if (parsedId === null) throw new ValidationError('campo "id" non valido');
  return conferenceRepository.resetOccorrenza({ id: parsedId, data: String(data || "") });
}
