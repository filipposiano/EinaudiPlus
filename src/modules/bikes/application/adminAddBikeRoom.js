// Assegna una bici a una camera dal pannello, invece che aspettare che il
// residente la dichiari da solo dalle sue Impostazioni — utile per chi non
// usa l'app, o per farlo fare alla reception. adminSet (a differenza di
// setBike, usata dal residente) marca la riga come assegnata dalla
// reception e dice se ha inserito davvero qualcosa di nuovo: solo allora si
// avvisa il residente, così un secondo tocco sulla stessa camera non manda
// una notifica doppia.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";

export async function adminAddBikeRoom({ room }, { bikeRepository, notifyRoom }) {
  const parsedRoom = parseRoomNumber(room);
  if (!parsedRoom) throw new ValidationError("numero di camera non valido");

  const esito = await bikeRepository.adminSet(parsedRoom);

  if (esito?.inserted) {
    await notifyRoom(
      parsedRoom,
      "Bici registrata",
      `La reception ha segnato che la tua camera (${parsedRoom}) ha una bici.`,
      "bici-registrata",
    );
  }

  return { ok: true, inserted: Boolean(esito?.inserted) };
}
