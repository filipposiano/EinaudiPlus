// Use-case: prenotazione pubblica di una fascia oraria in una sala comune.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";
import { isValidSpace, DAY_MIN, DAY_MAX, START_MIN, START_MAX, END_MIN, END_MAX } from "../domain/spaces.js";

export async function bookSpace({ space, day, start, end, name, type }, { commonSpacesRepository }) {
  const slug = String(space || "").trim();
  if (!isValidSpace(slug)) throw new ValidationError("sala non valida");

  const d = parseIntInRange(day, DAY_MIN, DAY_MAX);
  const s = parseIntInRange(start, START_MIN, START_MAX);
  const e = parseIntInRange(end, END_MIN, END_MAX);
  if (d === null || s === null || e === null) throw new ValidationError("giorno o orario non valido");

  return commonSpacesRepository.book({
    space: slug, day: d, start: s, end: e,
    name: String(name || ""),
    // `type` vale solo per il cinema; per la musica il database lo ignora
    // (vedi commento originale in api/rooms.js) — nessuna restrizione per
    // sala qui, è la stessa fedeltà all'originale.
    type: type === "private" || type === "open" ? type : null,
  });
}
