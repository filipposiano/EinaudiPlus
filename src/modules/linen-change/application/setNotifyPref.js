// Use-case: imposta la preferenza di notifica del cambio biancheria di
// QUESTA camera — on/off e orario di invio, letti/scritti dalle
// Impostazioni dell'app.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";
import { isValidTime } from "../domain/schedule.js";

export async function setNotifyPref({ room, enabled, notifyTime }, { linenChangeRepository }) {
  const parsedRoom = parseRoomNumber(room);
  if (!parsedRoom) throw new ValidationError("camera non valida");

  if (!isValidTime(notifyTime)) throw new ValidationError("orario non valido");

  return linenChangeRepository.setNotifyPref({
    room: parsedRoom, enabled: enabled !== false, notifyTime,
  });
}
