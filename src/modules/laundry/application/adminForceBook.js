// Use-case: forza una prenotazione da pannello, scavalcando i conflitti
// ordinari (uso raro, es. per sbloccare una situazione anomala).
//
// `room` è ora validato nella stessa forma del percorso pubblico bookSlot
// (numero di camera, o DIREZIONE) — chiusura di un'asimmetria segnalata
// nell'audit: l'originale non lo validava affatto, per nessuna delle due
// ragioni buone che di solito lo giustificano (qui l'admin digita il valore
// a mano, non è un campo derivato).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";
import { LAUNDRY_ID_MIN, LAUNDRY_ID_MAX, DAY_MIN, DAY_MAX, SLOT_MIN, SLOT_MAX } from "../domain/slots.js";

export async function adminForceBook({ laundryId, day, slot, machine, room }, { laundryRepository }) {
  const lid = parseIntInRange(laundryId, LAUNDRY_ID_MIN, LAUNDRY_ID_MAX);
  if (lid === null) throw new ValidationError('campo "laundry_id" non valido');
  const d = parseIntInRange(day, DAY_MIN, DAY_MAX);
  if (d === null) throw new ValidationError('campo "day" non valido');
  const s = parseIntInRange(slot, SLOT_MIN, SLOT_MAX);
  if (s === null) throw new ValidationError('campo "slot" non valido');

  const parsedRoom = parseRoomNumber(room);
  if (!parsedRoom && room !== "DIREZIONE") throw new ValidationError("camera non valida");

  return laundryRepository.forceBook({
    laundryId: lid, day: d, slot: s, machine: String(machine || ""), room: parsedRoom || room,
  });
}
