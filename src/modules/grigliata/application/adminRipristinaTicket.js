// Use-case: il delegato rimette "da usare" un ticket segnato come usato —
// uno slider trascinato per errore, la voce sbagliata. Il numero che aveva
// preso non torna libero (vedi grigliata_admin_ripristina_ticket in SQL):
// quando verrà usato di nuovo prenderà il successivo del contatore.

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";

export async function adminRipristinaTicket({ ticketId }, { grigliataRepository }) {
  const id = Number(ticketId);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("ticket non valido");

  try {
    return await grigliataRepository.adminRipristinaTicket(id);
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
