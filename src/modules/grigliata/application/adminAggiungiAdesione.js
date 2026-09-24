// Use-case: il delegato aggiunge (o corregge) a mano l'adesione di una
// camera — per chi non usa l'app, o per registrare chi ha dato la sua
// parola di persona. Stessa validazione di forma di iscriviti.js, ma qui la
// camera arriva scritta a mano dal delegato, non da un account già
// autenticato: va controllata nel formato, come fa ogni altro punto del
// pannello che accetta un numero di camera libero (vedi
// bikes/application/adminAddBikeRoom.js).
//
// v1.3: il menu è un id fra quelli dell'evento (lo verifica la SQL).

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";
import { idValido } from "../domain/validazione.js";

export async function adminAggiungiAdesione({ eventoId, room, menuId }, { grigliataRepository }) {
  const id = idValido(eventoId);
  if (!id) throw new ValidationError("evento non valido");

  const parsedRoom = parseRoomNumber(room);
  if (!parsedRoom) throw new ValidationError("numero di camera non valido");

  const menu = idValido(menuId);
  if (!menu) throw new ValidationError("scegli un menu");

  try {
    return await grigliataRepository.adminAggiungiAdesione({ eventoId: id, room: parsedRoom, menuId: menu });
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
