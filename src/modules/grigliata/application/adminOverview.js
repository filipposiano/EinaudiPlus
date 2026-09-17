// Use-case: la dashboard del delegato — l'evento più recente (attivo o
// l'ultimo chiuso) e la lista di chi ha aderito, con menu e stato del
// pagamento di ciascuno.

import { fromRpcError } from "../../../shared/errors/AppError.js";

export async function adminOverview(_input, { grigliataRepository }) {
  try {
    return await grigliataRepository.adminOverview();
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
