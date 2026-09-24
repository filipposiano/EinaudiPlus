// Use-case: il residente aderisce, con un menu. v1.1: non esiste più la
// possibilità di "declinare" — l'app tiene il conto solo di chi manifesta
// un interesse attivo (vedi la nota gemella in grigliata_iscrivi, in SQL).
//
// v1.3: oltre al menu (mangio tutto / vegetariano / vegano), "senza
// glutine" e una nota libera (allergie, intolleranze) — sono informazioni
// per chi cucina, non cambiano nulla del flusso di pagamento.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { isValidMenu, NOTE_MAX } from "../domain/validazione.js";

export async function iscriviti({ room, menu, senzaGlutine, note }, { grigliataRepository }) {
  const trimmedRoom = String(room || "").trim();
  if (!trimmedRoom) throw new ValidationError("camera mancante");

  const menuValue = String(menu || "");
  if (!isValidMenu(menuValue)) throw new ValidationError("scegli un menu");

  const noteValue = String(note ?? "").trim();
  if (noteValue.length > NOTE_MAX) throw new ValidationError(`nota troppo lunga (massimo ${NOTE_MAX} caratteri)`);

  return grigliataRepository.iscrivi({
    room: trimmedRoom,
    menu: menuValue,
    senzaGlutine: senzaGlutine === true,
    note: noteValue || null,
  });
}
