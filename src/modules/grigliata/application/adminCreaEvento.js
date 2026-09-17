// Use-case: il delegato (o il sistemista) fa partire una nuova grigliata.
//
// Un'unica azione: la funzione SQL chiude da sola qualunque grigliata ancora
// attiva prima di crearne una nuova (vedi grigliata_admin_crea) — la scheda
// residenti non deve mai scegliere fra due grigliate, quindi qui non serve
// nemmeno decidere "e se ce n'è già una aperta?", ci pensa il database in
// una sola transazione.

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";
import { isFutureDateTime } from "../domain/validazione.js";

export async function adminCreaEvento({ titolo, scadenza, paypalLink, satispayLink, attore }, { grigliataRepository }) {
  if (!isFutureDateTime(scadenza)) {
    throw new ValidationError("la scadenza deve essere una data futura");
  }

  const paypal = String(paypalLink || "").trim();
  const satispay = String(satispayLink || "").trim();
  if (!paypal && !satispay) {
    throw new ValidationError("inserisci almeno un link per il pagamento (PayPal o Satispay)");
  }

  try {
    return await grigliataRepository.adminCrea({
      titolo: String(titolo || "").trim() || "Grigliata",
      scadenza: new Date(scadenza).toISOString(),
      paypal: paypal || null,
      satispay: satispay || null,
      attore,
    });
  } catch (err) {
    // Vedi la stessa nota in linen-change/application/*.js: fromRpcError()
    // fa vedere al delegato/sistemista già autenticato il messaggio vero di
    // un fallimento della RPC, non il generico di wrapHandler.
    throw fromRpcError(err, { exposeToClient: true });
  }
}
