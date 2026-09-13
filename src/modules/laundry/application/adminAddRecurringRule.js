// Use-case: crea una regola ricorrente per la lavanderia (sistemista).
//
// Non si applica subito: resta inerte finché il cron settimanale non la
// materializza — vedi il commento originale in admin/data.js. La lettura,
// sospensione, cancellazione ed "applica ora" di una regola qualunque
// (lavanderia O sala) sono un concetto trasversale che questo modulo non
// possiede da solo — restano da migrare quando nascerà il modulo "ops"
// (vedi refactor-enterprise/ARCHITETTURA-ENTERPRISE.md).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { LAUNDRY_ID_MIN, LAUNDRY_ID_MAX, DAY_MIN, DAY_MAX, SLOT_MIN, SLOT_MAX } from "../domain/slots.js";

export async function adminAddRecurringRule({ laundryId, day, slot, machine, room, note }, { laundryRepository }) {
  const lid = parseIntInRange(laundryId, LAUNDRY_ID_MIN, LAUNDRY_ID_MAX);
  if (lid === null) throw new ValidationError('campo "laundry_id" non valido');
  const d = parseIntInRange(day, DAY_MIN, DAY_MAX);
  if (d === null) throw new ValidationError('campo "day" non valido');
  const s = parseIntInRange(slot, SLOT_MIN, SLOT_MAX);
  if (s === null) throw new ValidationError('campo "slot" non valido');

  return laundryRepository.addRecurringRule({
    laundryId: lid, day: d, slot: s,
    machine: String(machine || ""), room: String(room || ""),
    note: note ? String(note) : null,
  });
}
