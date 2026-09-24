// Use-case: FDO/sistemista chiude o riapre una sala (es. per il deposito
// dei pacchi). Mentre è chiusa, bookSpace() la rifiuta — vedi la nota
// gemella in book_space() lato SQL, che è l'unico posto dove il blocco è
// davvero garantito (anche a chi chiamasse l'RPC direttamente).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { isValidSpace } from "../domain/spaces.js";

export async function adminSetSpaceChiuso({ space, chiuso }, { commonSpacesRepository }) {
  const slug = String(space || "").trim();
  if (!isValidSpace(slug)) throw new ValidationError("sala non valida");

  return commonSpacesRepository.setChiuso({ space: slug, chiuso: Boolean(chiuso) });
}
