// Use-case: il delegato annulla una conferma di pagamento data per errore —
// "torna indietro". La SQL rifiuta da sola se anche un solo ticket di
// quell'adesione è già stato usato (vedi grigliata_admin_annulla_conferma_
// pagamento): qui non c'è altro da validare oltre alla forma dell'id.

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";

export async function adminAnnullaConfermaPagamento({ adesioneId }, { grigliataRepository }) {
  const id = Number(adesioneId);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("adesione non valida");

  try {
    return await grigliataRepository.adminAnnullaConfermaPagamento(id);
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
