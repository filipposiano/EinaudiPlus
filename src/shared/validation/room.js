// Formato del numero di camera — spostato qui da api/_lib/http.js perché lo
// usano più domini (lavanderia, bici, segnalazioni), non solo uno.

/**
 * Numero di camera nel formato ammesso: cifre, con una lettera a/b finale
 * facoltativa ("112", "21-b", "112A"). La stessa regex vive nelle funzioni
 * SQL, che restano l'autorità: questa serve a dare l'errore giusto subito,
 * prima di un giro di rete inutile.
 */
export function parseRoomNumber(v) {
  const s = String(v ?? "").trim();
  
  // ^(?:[1-9]|[1-4][0-9]|50|[1-5](?:0[1-9]|[1-2][0-9]|3[0-6]))(-?[abAB])?$
  const regex = /^(?:[1-9]|[1-4][0-9]|50|[1-5](?:0[1-9]|[1-2][0-9]|3[0-6]))(-?[abAB])?$/;
  
  return regex.test(s) ? s : null;
}