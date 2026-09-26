// Use-case: il delegato imposta (o toglie, lasciandola vuota) la quota a
// persona di una grigliata già partita. Indipendente dai pagamenti attivi:
// anche con i pagamenti spenti dice al residente quanto portare.

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";
import { idValido, controllaQuota } from "../domain/validazione.js";

export async function adminImpostaQuota({ eventoId, quota }, { grigliataRepository }) {
  const id = idValido(eventoId);
  if (!id) throw new ValidationError("evento non valido");

  const esito = controllaQuota(quota);
  if (esito.errore) throw new ValidationError(esito.errore);

  try {
    return await grigliataRepository.adminImpostaQuota({ id, quota: esito.quota });
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
