// Use-case: il residente aderisce, con un menu. v1.1: non esiste più la
// possibilità di "declinare" — l'app tiene il conto solo di chi manifesta
// un interesse attivo (vedi la nota gemella in grigliata_iscrivi, in SQL).
//
// v1.3: il menu è uno di quelli che il delegato ha definito per QUESTA
// grigliata (per id: che appartenga davvero all'evento attivo lo controlla
// la SQL), più "senza glutine" e una nota libera per chi cucina.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { idValido, NOTE_MAX } from "../domain/validazione.js";

export async function iscriviti({ room, menuId, senzaGlutine, note }, { grigliataRepository }) {
  const trimmedRoom = String(room || "").trim();
  if (!trimmedRoom) throw new ValidationError("camera mancante");

  const menu = idValido(menuId);
  if (!menu) throw new ValidationError("scegli un menu");

  const noteValue = String(note ?? "").trim();
  if (noteValue.length > NOTE_MAX) throw new ValidationError(`nota troppo lunga (massimo ${NOTE_MAX} caratteri)`);

  return grigliataRepository.iscrivi({
    room: trimmedRoom,
    menuId: menu,
    senzaGlutine: senzaGlutine === true,
    note: noteValue || null,
  });
}
