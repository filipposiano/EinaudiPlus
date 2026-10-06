// Use-case: il residente "usa" il proprio ticket — l'azione va premuta
// davanti a chi serve il cibo, non prima: il numero progressivo che la RPC
// assegna esiste solo a partire da questo momento (vedi grigliata_usa_ticket
// in SQL), quindi uno screenshot fatto in anticipo non mostra nulla di
// valido. Percorso pubblico come dichiaraPagamento.js: nessuna sessione,
// camera autodichiarata.

import { ValidationError } from "../../../shared/errors/AppError.js";

export async function usaTicket({ room }, { grigliataRepository }) {
  const trimmedRoom = String(room || "").trim();
  if (!trimmedRoom) throw new ValidationError("camera mancante");

  return grigliataRepository.usaTicket(trimmedRoom);
}
