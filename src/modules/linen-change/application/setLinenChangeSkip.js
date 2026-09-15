// Use-case: salta (o riabilita) il cambio biancheria di un martedì specifico,
// senza toccare l'ancora — vedi la nota su linen_change_type_for() in SQL:
// un salto non consuma un turno dell'alternanza, il martedì dopo torna al
// tipo che avrebbe avuto comunque.

import { ValidationError, fromRpcError } from "../../../shared/errors/AppError.js";
import { isTuesdayISO } from "../domain/schedule.js";

export async function setLinenChangeSkip({ data, salta }, { linenChangeRepository }) {
  const dataValue = String(data || "");
  if (!isTuesdayISO(dataValue)) throw new ValidationError("la data deve essere un martedì");

  try {
    return await linenChangeRepository.setSkip({ data: dataValue, salta: Boolean(salta) });
  } catch (err) {
    // Vedi la stessa nota in getLinenChangeAnchor.js. È anche il caso più
    // probabile in pratica finché migrations/036 non è applicata: la RPC
    // linen_change_set_skip non esiste ancora, e senza questo l'admin
    // vedrebbe "errore del server, riprova" invece del messaggio di
    // PostgREST ("Could not find the function...") che gli direbbe subito
    // cosa manca.
    throw fromRpcError(err, { exposeToClient: true });
  }
}
