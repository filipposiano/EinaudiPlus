// Use-case: salta (o riabilita) il cambio biancheria di un martedì specifico,
// senza toccare l'ancora — vedi la nota su linen_change_type_for() in SQL:
// un salto non consuma un turno dell'alternanza, il martedì dopo torna al
// tipo che avrebbe avuto comunque.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { isTuesdayISO } from "../domain/schedule.js";

export async function setLinenChangeSkip({ data, salta }, { linenChangeRepository }) {
  const dataValue = String(data || "");
  if (!isTuesdayISO(dataValue)) throw new ValidationError("la data deve essere un martedì");

  return linenChangeRepository.setSkip({ data: dataValue, salta: Boolean(salta) });
}
