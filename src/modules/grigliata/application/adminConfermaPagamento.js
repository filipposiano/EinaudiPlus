// Use-case: il delegato conferma di aver ricevuto la quota di una camera.
//
// Trigger la notifica alla camera SOLO se la conferma è andata a buon fine
// (esito.ok e una room valida): un id sbagliato o già inesistente non deve
// avvisare nessuno.

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";

export async function adminConfermaPagamento({ adesioneId, attore }, { grigliataRepository, notifyRoom }) {
  const id = Number(adesioneId);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("adesione non valida");

  let esito;
  try {
    esito = await grigliataRepository.adminConfermaPagamento({ id, attore });
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }

  if (esito?.ok && esito.room) {
    await notifyRoom(
      esito.room,
      "Pagamento confermato",
      `Il tuo pagamento per "${esito.titolo || "la Grigliata"}" è stato confermato. Buon appetito!`,
      "grigliata-pagamento",
    );
  }

  return esito;
}
