// Use-case: il residente dichiara di aver inviato la quota. Non conferma
// nulla da sola: è solo "ho pagato, ora tocca al delegato verificarlo" —
// la conferma vera è un'azione separata, admin (vedi adminConfermaPagamento).

import { ValidationError } from "../../../shared/errors/AppError.js";

export async function dichiaraPagamento({ room }, { grigliataRepository }) {
  const trimmedRoom = String(room || "").trim();
  if (!trimmedRoom) throw new ValidationError("camera mancante");

  return grigliataRepository.dichiaraPagamento(trimmedRoom);
}
