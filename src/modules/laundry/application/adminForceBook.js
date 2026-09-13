// Use-case: forza una prenotazione da pannello, scavalcando i conflitti
// ordinari (uso raro, es. per sbloccare una situazione anomala).
//
// Fedele all'originale: `room` non è validato nella forma "numero di stanza"
// (a differenza del percorso pubblico bookSlot) — passa come stringa grezza.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { LAUNDRY_ID_MIN, LAUNDRY_ID_MAX, DAY_MIN, DAY_MAX, SLOT_MIN, SLOT_MAX } from "../domain/slots.js";

export async function adminForceBook({ laundryId, day, slot, machine, room }, { laundryRepository }) {
  const lid = parseIntInRange(laundryId, LAUNDRY_ID_MIN, LAUNDRY_ID_MAX);
  if (lid === null) throw new ValidationError('campo "laundry_id" non valido');
  const d = parseIntInRange(day, DAY_MIN, DAY_MAX);
  if (d === null) throw new ValidationError('campo "day" non valido');
  const s = parseIntInRange(slot, SLOT_MIN, SLOT_MAX);
  if (s === null) throw new ValidationError('campo "slot" non valido');

  return laundryRepository.forceBook({
    laundryId: lid, day: d, slot: s, machine: String(machine || ""), room: String(room || ""),
  });
}
