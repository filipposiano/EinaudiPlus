// Use-case: prenota una fascia oraria a nome della DIREZIONE (usato
// dall'app principale quando chi ha effettuato l'accesso è la portineria).
//
// Lo slug della sala è ora validato contro l'elenco SPACES, come il
// percorso pubblico bookSpace — chiusura di un'asimmetria segnalata
// nell'audit.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { isValidSpace, DAY_MIN, DAY_MAX, START_MIN, START_MAX, END_MIN, END_MAX } from "../domain/spaces.js";

export async function adminBookAsDirezione({ space, day, start, end, type }, { commonSpacesRepository }) {
  const slug = String(space || "").trim();
  if (!isValidSpace(slug)) throw new ValidationError("sala non valida");

  const d = parseIntInRange(day, DAY_MIN, DAY_MAX);
  if (d === null) throw new ValidationError('campo "day" non valido');
  const s = parseIntInRange(start, START_MIN, START_MAX);
  if (s === null) throw new ValidationError('campo "start" non valido');
  const e = parseIntInRange(end, END_MIN, END_MAX);
  if (e === null) throw new ValidationError('campo "end" non valido');

  return commonSpacesRepository.bookAsDirezione({
    space: slug, day: d, start: s, end: e,
    type: type ? String(type) : null,
  });
}
