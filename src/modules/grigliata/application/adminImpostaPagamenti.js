// Use-case: il delegato attiva o disattiva i pagamenti di una grigliata già
// partita, a piacimento. Spegnerli NON tocca i flag di pagamento delle
// adesioni (restano salvati, solo nascosti): riaccendendoli ricompaiono le
// conferme già date. Riaccenderli su un evento senza nessun link li
// richiede — lo verifica anche la SQL (grigliata_admin_imposta_pagamenti),
// che tiene i link salvati quando qui arrivano vuoti.

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";
import { idValido } from "../domain/validazione.js";

export async function adminImpostaPagamenti({ eventoId, attivi, paypalLink, satispayLink }, { grigliataRepository }) {
  const id = idValido(eventoId);
  if (!id) throw new ValidationError("evento non valido");
  if (typeof attivi !== "boolean") throw new ValidationError("valore non valido");

  try {
    return await grigliataRepository.adminImpostaPagamenti({
      id, attivi,
      paypal: String(paypalLink || "").trim() || null,
      satispay: String(satispayLink || "").trim() || null,
    });
  } catch (err) {
    throw fromRpcError(err, { exposeToClient: true });
  }
}
