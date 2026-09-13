import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { ID_MIN, ID_MAX } from "../domain/rules.js";

export async function moveOccurrence({ id, data, nuovaData, inizio, fine, titolo, note, attore }, { conferenceRepository }) {
  const parsedId = parseIntInRange(id, ID_MIN, ID_MAX);
  if (parsedId === null) throw new ValidationError('campo "id" non valido');

  return conferenceRepository.move({
    id: parsedId,
    data: String(data || ""), nuovaData: String(nuovaData || ""),
    oraInizio: inizio ? String(inizio) : null,
    oraFine: fine ? String(fine) : null,
    titolo: titolo ? String(titolo) : null,
    note: note ? String(note) : null,
    attore,
  });
}
