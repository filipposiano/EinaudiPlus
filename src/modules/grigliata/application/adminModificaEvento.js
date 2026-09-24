// Use-case: cambia titolo, scadenza e menu di un evento esistente — per
// correggere un nome o una data sbagliata, dare più tempo, o aggiungere/
// rinominare/togliere un menu, senza chiudere l'evento e farne ripartire
// uno nuovo (il che azzererebbe le adesioni già raccolte: vedi
// adminCreaEvento.js).
//
// I menu viaggiano con il loro id quando esistono già: è così che la SQL
// distingue "rinominato" da "tolto e aggiunto" — e rifiuta di togliere un
// menu che qualche camera ha già scelto.

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";
import { isFutureDateTime, controllaMenu, idValido } from "../domain/validazione.js";

export async function adminModificaEvento({ eventoId, titolo, scadenza, menu }, { grigliataRepository }) {
  const id = idValido(eventoId);
  if (!id) throw new ValidationError("evento non valido");

  if (!isFutureDateTime(scadenza)) {
    throw new ValidationError("la scadenza deve essere una data futura");
  }

  const esito = controllaMenu(menu);
  if (esito.errore) throw new ValidationError(esito.errore);

  try {
    // Titolo assente: ricade su 'Grigliata' lato SQL (stessa regola di
    // grigliata_admin_crea) — qui si ripulisce solo, non si respinge.
    return await grigliataRepository.adminModifica({
      id, titolo: String(titolo || "").trim(), scadenza: new Date(scadenza).toISOString(), menu: esito.menu,
    });
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
