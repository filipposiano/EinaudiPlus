// Use-case: prenota un turno a nome della DIREZIONE (usato dall'app
// principale quando chi ha effettuato l'accesso è la portineria/staff, non
// un residente vero).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { LAUNDRY_ID_MIN, LAUNDRY_ID_MAX, DAY_MIN, DAY_MAX, SLOT_MIN, SLOT_MAX } from "../domain/slots.js";

export async function adminBookAsDirezione({ laundryId, day, slot, machine }, { laundryRepository }) {
  const lid = parseIntInRange(laundryId, LAUNDRY_ID_MIN, LAUNDRY_ID_MAX);
  if (lid === null) throw new ValidationError('campo "laundry_id" non valido');
  const d = parseIntInRange(day, DAY_MIN, DAY_MAX);
  if (d === null) throw new ValidationError('campo "day" non valido');
  const s = parseIntInRange(slot, SLOT_MIN, SLOT_MAX);
  if (s === null) throw new ValidationError('campo "slot" non valido');

  return laundryRepository.bookAsDirezione({ laundryId: lid, day: d, slot: s, machine: String(machine || "") });
}
