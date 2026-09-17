// Use-case: il delegato toglie a mano l'adesione di una camera — la riga
// sparisce del tutto, la camera torna come se non avesse mai risposto. Per
// disfare un'adesione aggiunta per sbaglio, o una camera che il delegato sa
// per certo non parteciperà più.

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";

export async function adminRimuoviAdesione({ adesioneId }, { grigliataRepository }) {
  const id = Number(adesioneId);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("adesione non valida");

  try {
    return await grigliataRepository.adminRimuoviAdesione(id);
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
