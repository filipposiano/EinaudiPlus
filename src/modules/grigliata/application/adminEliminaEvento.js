// Use-case: elimina un evento chiuso e, per cascata, le sue adesioni —
// irreversibile. La funzione SQL rifiuta da sola un evento ancora attivo
// (va chiuso prima); qui c'è solo la validazione di forma sull'id, prima
// di spendere una chiamata di rete.

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";

export async function adminEliminaEvento({ eventoId }, { grigliataRepository }) {
  const id = Number(eventoId);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("evento non valido");

  try {
    return await grigliataRepository.adminElimina(id);
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
