import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { GIORNO_MIN, GIORNO_MAX } from "../domain/rules.js";

/** null = ogni giorno del periodo (convegno di più giorni consecutivi);
 *  un numero = solo quel giorno della settimana. */
function parseGiorno(giorno) {
  if (giorno === null || giorno === undefined || giorno === "") return null;
  const parsed = parseIntInRange(giorno, GIORNO_MIN, GIORNO_MAX);
  if (parsed === null) throw new ValidationError('campo "giorno" non valido');
  return parsed;
}

export async function addRule({ titolo, inizio, fine, dal, al, giorno, note, attore }, { conferenceRepository }) {
  return conferenceRepository.add({
    titolo: String(titolo || ""), oraInizio: String(inizio || ""), oraFine: String(fine || ""),
    dal: String(dal || ""), al: String(al || ""),
    giornoSettimana: parseGiorno(giorno),
    note: note ? String(note) : null,
    attore,
  });
}
