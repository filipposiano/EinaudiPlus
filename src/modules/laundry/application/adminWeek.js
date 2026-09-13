// Use-case: griglia settimanale di una lavanderia, per il pannello admin.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { LAUNDRY_ID_MIN, LAUNDRY_ID_MAX, OFFSET_MIN, OFFSET_MAX } from "../domain/slots.js";

export async function adminWeek({ laundryId, offset }, { laundryRepository }) {
  const lid = parseIntInRange(laundryId, LAUNDRY_ID_MIN, LAUNDRY_ID_MAX);
  if (lid === null) throw new ValidationError('campo "laundry_id" non valido');

  // offset assente = settimana corrente (comportamento originale: `Number(body.offset || 0)`).
  const off = (offset === undefined || offset === null) ? 0 : parseIntInRange(offset, OFFSET_MIN, OFFSET_MAX);
  if (off === null) throw new ValidationError('campo "offset" non valido');

  return laundryRepository.week({ laundryId: lid, offset: off });
}
