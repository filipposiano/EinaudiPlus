// Come adminAddBikeRoom, ma al contrario: avvisa il residente solo se
// c'era davvero una bici da togliere (deleteRoom dice `deleted`), così un
// tocco su una camera già senza bici non manda nessun avviso.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";

export async function adminDeleteBikeRoom({ room }, { bikeRepository, notifyRoom }) {
  const parsedRoom = parseRoomNumber(room);
  if (!parsedRoom) throw new ValidationError("numero di camera non valido");

  const result = await bikeRepository.deleteRoom(parsedRoom);

  if (result?.deleted) {
    await notifyRoom(
      parsedRoom,
      "Bici rimossa",
      `La reception ha tolto la bici segnata per la tua camera (${parsedRoom}).`,
      "bici-rimossa",
    );
  }

  return result;
}
