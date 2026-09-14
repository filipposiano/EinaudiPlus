// Use-case: crea una regola ricorrente per una sala comune (sistemista).
//
// La lettura, sospensione, cancellazione ed "applica ora" di una regola
// qualunque (lavanderia O sala) restano un concetto trasversale che né
// questo modulo né Laundry possiedono da soli — rimandate a un futuro
// modulo "ops" (vedi refactor-enterprise/ARCHITETTURA-ENTERPRISE.md).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { SPACE_ID_MIN, SPACE_ID_MAX, DAY_MIN, DAY_MAX, START_MIN, START_MAX, END_MIN, END_MAX } from "../domain/spaces.js";

export async function adminAddRecurringRule({ spaceId, day, start, end, name, type, note }, { commonSpacesRepository }) {
  const sid = parseIntInRange(spaceId, SPACE_ID_MIN, SPACE_ID_MAX);
  if (sid === null) throw new ValidationError('campo "space_id" non valido');
  const d = parseIntInRange(day, DAY_MIN, DAY_MAX);
  if (d === null) throw new ValidationError('campo "day" non valido');
  const s = parseIntInRange(start, START_MIN, START_MAX);
  if (s === null) throw new ValidationError('campo "start" non valido');
  const e = parseIntInRange(end, END_MIN, END_MAX);
  if (e === null) throw new ValidationError('campo "end" non valido');

  return commonSpacesRepository.addRecurringRule({
    spaceId: sid, day: d, start: s, end: e,
    name: String(name || ""), type: type ? String(type) : null, note: note ? String(note) : null,
  });
}
