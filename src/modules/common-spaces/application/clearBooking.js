// Use-case: cancellazione pubblica di una prenotazione (percorso non
// amministrativo — 'clear' e 'delete' sono la stessa cosa, vedi
// api/rooms.js originale per la ragione delle due grafie accettate).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { isValidSpace } from "../domain/spaces.js";

export async function clearBooking({ space, id }, { commonSpacesRepository }) {
  const slug = String(space || "").trim();
  if (!isValidSpace(slug)) throw new ValidationError("sala non valida");
  return commonSpacesRepository.clear({ space: slug, id: String(id || "") });
}
