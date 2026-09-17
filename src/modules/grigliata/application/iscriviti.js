// Use-case: il residente aderisce, con un menu. v1.1: non esiste più la
// possibilità di "declinare" — l'app tiene il conto solo di chi manifesta
// un interesse attivo (vedi la nota gemella in grigliata_iscrivi, in SQL).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { isValidMenu } from "../domain/validazione.js";

export async function iscriviti({ room, menu }, { grigliataRepository }) {
  const trimmedRoom = String(room || "").trim();
  if (!trimmedRoom) throw new ValidationError("camera mancante");

  const menuValue = String(menu || "");
  if (!isValidMenu(menuValue)) throw new ValidationError("scegli un menu");

  return grigliataRepository.iscrivi({ room: trimmedRoom, menu: menuValue });
}
