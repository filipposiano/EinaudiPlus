// Use-case: il residente dà (o ritira) l'adesione, con il menu se partecipa.
//
// Chi non partecipa non ha un menu da ricordare: il valore si azzera qui,
// prima ancora di arrivare al database — non ha senso salvare "vegano" per
// chi ha appena detto che non viene.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { isValidMenu } from "../domain/validazione.js";

export async function iscriviti({ room, partecipa, menu }, { grigliataRepository }) {
  const trimmedRoom = String(room || "").trim();
  if (!trimmedRoom) throw new ValidationError("camera mancante");

  const partecipaBool = Boolean(partecipa);
  const menuValue = partecipaBool ? String(menu || "") : "";

  if (partecipaBool && !isValidMenu(menuValue)) {
    throw new ValidationError("scegli un menu");
  }

  return grigliataRepository.iscrivi({ room: trimmedRoom, partecipa: partecipaBool, menu: menuValue || null });
}
