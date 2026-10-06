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
import { isValidDate, controllaMenu, idValido } from "../domain/validazione.js";

export async function adminModificaEvento({ eventoId, titolo, scadenza, giornoEvento, menu }, { grigliataRepository }) {
  const id = idValido(eventoId);
  if (!id) throw new ValidationError("evento non valido");

  // Può essere anche già passata: iscrizioni chiuse alla partenza, scheda
  // comunque visibile fino al giorno dopo la grigliata.
  if (!isValidDate(scadenza)) {
    throw new ValidationError("indica la scadenza delle iscrizioni");
  }

  if (!isValidDate(giornoEvento)) {
    throw new ValidationError("indica il giorno della grigliata");
  }

  const esito = controllaMenu(menu);
  if (esito.errore) throw new ValidationError(esito.errore);

  try {
    // Titolo assente: ricade su 'Grigliata' lato SQL (stessa regola di
    // grigliata_admin_crea) — qui si ripulisce solo, non si respinge.
    return await grigliataRepository.adminModifica({
      id, titolo: String(titolo || "").trim(), scadenza: new Date(scadenza).toISOString(),
      giornoEvento: String(giornoEvento).trim(), menu: esito.menu,
    });
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
