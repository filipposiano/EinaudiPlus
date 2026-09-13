// Use-case: liberare un turno dal percorso pubblico (non amministrativo —
// `p_as_admin` non esiste qui, vedi infrastructure/laundryRepository.js).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";
import { DAY_MIN, DAY_MAX, SLOT_MIN, SLOT_MAX } from "../domain/slots.js";

export async function clearSlot({ room, day, slot, machine }, { laundryRepository }) {
  const d = parseIntInRange(day, DAY_MIN, DAY_MAX);
  const s = parseIntInRange(slot, SLOT_MIN, SLOT_MAX);
  if (d === null || s === null) throw new ValidationError("giorno o turno non valido");

  // La camera è opzionale qui: il client installato non la manda sulla clear
  // pubblica, e deve continuare a funzionare. Assente o malformata -> null,
  // decide il database, non un rifiuto lato JS.
  return laundryRepository.clear({
    room: parseRoomNumber(room), day: d, slot: s, machine: String(machine || ""),
  });
}
