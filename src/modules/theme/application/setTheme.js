// Use-case: imposta il tema stagionale (sistemista).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { isValidTheme } from "../domain/theme.js";

export async function setTheme({ tema }, { themeRepository }) {
  const value = String(tema || "");
  if (!isValidTheme(value)) throw new ValidationError("tema non valido");
  return themeRepository.set(value);
}
