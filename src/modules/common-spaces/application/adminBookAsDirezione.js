// Use-case: prenota una fascia oraria a nome della DIREZIONE (usato
// dall'app principale quando chi ha effettuato l'accesso è la portineria).
//
// Fedele all'originale: qui lo slug della sala NON è validato contro
// l'elenco SPACES (a differenza del percorso pubblico bookSpace) — passa
// come stringa grezza, decide la funzione SQL.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { DAY_MIN, DAY_MAX, START_MIN, START_MAX, END_MIN, END_MAX } from "../domain/spaces.js";

export async function adminBookAsDirezione({ space, day, start, end, type }, { commonSpacesRepository }) {
  const d = parseIntInRange(day, DAY_MIN, DAY_MAX);
  if (d === null) throw new ValidationError('campo "day" non valido');
  const s = parseIntInRange(start, START_MIN, START_MAX);
  if (s === null) throw new ValidationError('campo "start" non valido');
  const e = parseIntInRange(end, END_MIN, END_MAX);
  if (e === null) throw new ValidationError('campo "end" non valido');

  return commonSpacesRepository.bookAsDirezione({
    space: String(space || ""), day: d, start: s, end: e,
    type: type ? String(type) : null,
  });
}
