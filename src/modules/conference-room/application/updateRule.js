import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { ID_MIN, ID_MAX, GIORNO_MIN, GIORNO_MAX } from "../domain/rules.js";

function parseGiorno(giorno) {
  if (giorno === null || giorno === undefined || giorno === "") return null;
  const parsed = parseIntInRange(giorno, GIORNO_MIN, GIORNO_MAX);
  if (parsed === null) throw new ValidationError('campo "giorno" non valido');
  return parsed;
}

export async function updateRule({ id, titolo, inizio, fine, dal, al, giorno, note }, { conferenceRepository }) {
  const parsedId = parseIntInRange(id, ID_MIN, ID_MAX);
  if (parsedId === null) throw new ValidationError('campo "id" non valido');

  return conferenceRepository.update({
    id: parsedId,
    titolo: String(titolo || ""), oraInizio: String(inizio || ""), oraFine: String(fine || ""),
    dal: String(dal || ""), al: String(al || ""),
    giornoSettimana: parseGiorno(giorno),
    note: note ? String(note) : null,
  });
}
