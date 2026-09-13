// Use-case: prenotazione pubblica di un turno lavanderia.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";
import { DAY_MIN, DAY_MAX, SLOT_MIN, SLOT_MAX } from "../domain/slots.js";

export async function bookSlot({ room, day, slot, machine, actorRoom }, { laundryRepository }) {
  const d = parseIntInRange(day, DAY_MIN, DAY_MAX);
  const s = parseIntInRange(slot, SLOT_MIN, SLOT_MAX);
  if (d === null || s === null) throw new ValidationError("giorno o turno non valido");

  const parsedRoom = parseRoomNumber(room);
  if (!parsedRoom) throw new ValidationError("camera non valida");

  return laundryRepository.book({
    room: parsedRoom, day: d, slot: s,
    machine: String(machine || ""),
    // Da dove si sta prenotando, distinto dall'intestatario del turno:
    // impedisce che dalla Manica si prenoti una macchina del Valentino (e
    // viceversa). Assente o malformato -> null, non un rifiuto: i client
    // installati prima di questo controllo non lo mandano affatto, e devono
    // continuare a funzionare (il controllo si disattiva per loro, non si
    // rompe).
    actorRoom: parseRoomNumber(actorRoom),
  });
}
