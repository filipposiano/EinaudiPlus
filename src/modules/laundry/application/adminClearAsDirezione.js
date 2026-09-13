// Use-case: libera un turno passando per l'amministrazione — l'unico modo
// per liberare anche i turni della DIREZIONE, protetti sul percorso pubblico
// (`p_as_admin: true` può comparire solo qui: currentAdmin() ha già
// verificato il cookie a monte, nell'adapter).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { DAY_MIN, DAY_MAX, SLOT_MIN, SLOT_MAX } from "../domain/slots.js";

export async function adminClearAsDirezione({ room, day, slot, machine }, { laundryRepository }) {
  const d = parseIntInRange(day, DAY_MIN, DAY_MAX);
  if (d === null) throw new ValidationError('campo "day" non valido');
  const s = parseIntInRange(slot, SLOT_MIN, SLOT_MAX);
  if (s === null) throw new ValidationError('campo "slot" non valido');

  // Fedele all'originale: qui la camera non è validata nella forma "numero di
  // stanza" — clearDirezione libera un turno per posizione (giorno+turno+
  // macchina), non per proprietario, e passa come stringa grezza.
  return laundryRepository.clearAsAdmin({
    room: String(room || ""), day: d, slot: s, machine: String(machine || ""),
  });
}
