// Use-case: elenco segnalazioni per il pannello admin.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseIntInRange } from "../../../shared/validation/number.js";

export async function adminListFeedback({ onlyOpen, limit }, { feedbackRepository }) {
  // Il vecchio dizionario LIMITI validava "limit" [1,500] solo se presente,
  // prima di arrivare qui: Number(x) non valido dava NaN -> null una volta
  // serializzato -> 500 dal database. Ora il modulo valida da sé.
  const parsedLimit = limit === undefined || limit === null ? 100 : parseIntInRange(limit, 1, 500);
  if (parsedLimit === null) throw new ValidationError('campo "limit" non valido');

  return feedbackRepository.list({ onlyOpen: onlyOpen !== false, limit: parsedLimit });
}
