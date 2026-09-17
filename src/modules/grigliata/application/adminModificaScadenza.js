// Use-case: sposta la scadenza di un evento esistente — per correggere una
// data sbagliata o dare più tempo, senza chiudere l'evento e farne ripartire
// uno nuovo (il che azzererebbe le adesioni già raccolte: vedi
// adminCreaEvento.js).

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";
import { isFutureDateTime } from "../domain/validazione.js";

export async function adminModificaScadenza({ eventoId, scadenza }, { grigliataRepository }) {
  const id = Number(eventoId);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("evento non valido");

  if (!isFutureDateTime(scadenza)) {
    throw new ValidationError("la scadenza deve essere una data futura");
  }

  try {
    return await grigliataRepository.adminModificaScadenza({ id, scadenza: new Date(scadenza).toISOString() });
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
