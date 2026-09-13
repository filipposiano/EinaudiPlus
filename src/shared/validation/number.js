// Validazione di interi con limiti — spostata qui da api/_lib/http.js perché
// non è specifica della lavanderia: qualunque modulo con un campo numerico
// vincolato (giorno, turno, id, offset...) ne ha bisogno.
//
// Number("pippo") dà NaN, che JSON.stringify serializza come null: in SQL un
// vincolo "not between" su NULL vale NULL (non scatta), quindi la richiesta
// tirava dritto e sbatteva contro un vincolo NOT NULL più a valle — il client
// riceveva un 500 "errore del server" per un campo semplicemente scritto
// male. Qui il valore o è un intero nell'intervallo, o è null e la richiesta
// va respinta prima di toccare il database.

/** Intero dentro [min, max], oppure null. Rifiuta NaN, decimali e stringhe. */
export function parseIntInRange(v, min, max) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}
