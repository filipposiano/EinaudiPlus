/**
 * Numero di camera nel formato ammesso: cifre, con una lettera a/b finale
 * facoltativa ("112", "21-b", "112A"). La stessa regex vive nelle funzioni
 * SQL, che restano l'autorità: questa serve a dare l'errore giusto subito,
 * prima di un giro di rete inutile.
 */
export function parseRoomNumber(v) {
  const s = String(v ?? "").trim();
  
  // Aggiunto 0* per consentire zeri iniziali alle camere 1-50 (es. "021", "007")
  const regex = /^(?:0*(?:[1-9]|[1-4][0-9]|50)|[1-5](?:0[1-9]|[1-2][0-9]|3[0-6]))(-?[abAB])?$/;
  
  return regex.test(s) ? s : null;
}