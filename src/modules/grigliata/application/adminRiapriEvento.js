// Use-case: riapre un evento chiuso. Chiude da sola qualunque ALTRO evento
// ancora attivo (vedi la nota estesa su grigliata_admin_riapri in SQL): non
// tocca la scadenza, quindi un evento la cui data è già passata torna
// "non chiuso" ma resta comunque non attivo finché non si sposta anche la
// data — due azioni distinte, non una.

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";

export async function adminRiapriEvento({ eventoId }, { grigliataRepository }) {
  const id = Number(eventoId);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("evento non valido");

  try {
    return await grigliataRepository.adminRiapri(id);
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
