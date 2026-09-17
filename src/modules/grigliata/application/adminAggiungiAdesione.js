// Use-case: il delegato aggiunge (o corregge) a mano l'adesione di una
// camera — per chi non usa l'app, o per registrare chi ha dato la sua
// parola di persona. Stessa validazione di forma di iscriviti.js (camera,
// menu se partecipa), ma qui la camera arriva scritta a mano dal delegato,
// non da un account già autenticato: va controllata nel formato, come fa
// ogni altro punto del pannello che accetta un numero di camera libero
// (vedi bikes/application/adminAddBikeRoom.js).

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";
import { isValidMenu } from "../domain/validazione.js";

export async function adminAggiungiAdesione({ eventoId, room, menu }, { grigliataRepository }) {
  const id = Number(eventoId);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("evento non valido");

  const parsedRoom = parseRoomNumber(room);
  if (!parsedRoom) throw new ValidationError("numero di camera non valido");

  if (!isValidMenu(menu)) throw new ValidationError("scegli un menu");

  try {
    return await grigliataRepository.adminAggiungiAdesione({ eventoId: id, room: parsedRoom, menu });
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
