// Use-case: chiude un evento a mano, prima della scadenza naturale — utile
// se il delegato vuole smettere di raccogliere adesioni prima del previsto.

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";

export async function adminChiudiEvento({ eventoId }, { grigliataRepository }) {
  const id = Number(eventoId);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("evento non valido");

  try {
    return await grigliataRepository.adminChiudi(id);
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
