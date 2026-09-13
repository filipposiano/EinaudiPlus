// Use-case: lettura pubblica delle prenotazioni di una sala.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { isValidSpace } from "../domain/spaces.js";

export async function getBookings({ space }, { commonSpacesRepository }) {
  const slug = String(space || "").trim();
  if (!isValidSpace(slug)) throw new ValidationError("sala non valida");
  return commonSpacesRepository.bookings(slug);
}
