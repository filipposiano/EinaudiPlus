// Use-case: la preferenza di notifica del cambio biancheria di QUESTA
// camera — percorso pubblico (dalle Impostazioni dell'app), camera
// autodichiarata come il resto dell'app.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";

export async function getNotifyPref({ room }, { linenChangeRepository }) {
  const parsedRoom = parseRoomNumber(room);
  if (!parsedRoom) throw new ValidationError("camera non valida");

  return linenChangeRepository.getNotifyPref(parsedRoom);
}
