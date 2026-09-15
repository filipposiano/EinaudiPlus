// Use-case: sposta l'ancora del cambio biancheria (pannello admin).
//
// Un'unica azione copre sia la correzione occasionale sia la ripartenza dopo
// una chiusura del collegio: in entrambi i casi si sceglie QUALE martedì è
// di che tipo, e ogni altro martedì — passato o futuro — si ricalcola da lì
// (vedi linen_change_type_for() in SQL).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { isValidTipo, isTuesdayISO } from "../domain/schedule.js";

export async function setLinenChangeAnchor({ data, tipo }, { linenChangeRepository }) {
  const value = String(tipo || "");
  if (!isValidTipo(value)) throw new ValidationError("tipo non valido");

  const dataValue = String(data || "");
  if (!isTuesdayISO(dataValue)) throw new ValidationError("la data deve essere un martedì");

  return linenChangeRepository.setAnchor({ data: dataValue, tipo: value });
}
