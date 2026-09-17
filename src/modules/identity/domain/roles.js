// Regole di dominio dell'identità: quali ruoli esistono e chi può fare cosa
// sulle azioni che QUESTO modulo possiede (account amministrativi).
//
// Risolve l'audit finding #3: nel codice attuale (api/admin/data.js) le
// action riservate al sistemista vivono in un Set() centrale mantenuto a
// mano, separato dalle action stesse — un'azione nuova non finisce lì
// automaticamente, e il controllore ha zero modo di accorgersi che manca.
// Qui la policy sta accanto alle azioni che descrive: aggiungere un'azione
// account senza decidere la sua policy non è possibile, perché authorize()
// è l'unico modo con cui l'adapter scopre se può procedere.

/**
 * `fdo` e `staff` hanno gli stessi poteri operativi (macchine, segnalazioni,
 * prenotazioni per la Direzione, sala conferenze), ma restano ruoli distinti:
 * l'audit log registra CHI ha fatto cosa, e "l'ha fatto la portineria" e
 * "l'ha fatto lo staff" sono due risposte diverse in caso di dubbio su una
 * macchina segnata guasta. `sistemista` può in più le regole ricorrenti,
 * la pulizia dei dati e la gestione degli altri account.
 *
 * `delegato` è diverso in natura dagli altri tre: non è un livello in più di
 * fiducia operativa, è un ruolo STRETTO a una sola cosa — organizzare una
 * Grigliata (vedi src/modules/grigliata). Un delegato non vede macchine,
 * segnalazioni, bici, ne' nessun'altra sezione: la sua policy vive nel
 * modulo Grigliata, non qui. Il sistemista resta sopra a tutti, delegato
 * compreso, e vede anche la Grigliata.
 */
export const RUOLI = new Set(["fdo", "staff", "sistemista", "delegato"]);

export function isValidRole(role) {
  return RUOLI.has(role);
}

export function isSysadmin(claims) {
  return claims?.r === "sistemista";
}

export function isStaff(claims) {
  return claims?.r === "staff";
}

export function isDelegato(claims) {
  return claims?.r === "delegato";
}

// Azioni di gestione account riservate al sistemista.
const SOLO_SISTEMISTA = new Set([
  "accountList", "accountCreate", "accountSetPassword", "accountSetActive", "accountDelete",
]);

/**
 * Decide se `claims` può eseguire `action`.
 *
 * Torna `null` (non `false`) quando l'azione non appartiene a questo modulo:
 * è la differenza fra "vietato" e "non è affar mio", e serve al chiamante
 * (l'adapter che smista fra moduli) per sapere se deve continuare a cercare
 * altrove o fermarsi con un 403.
 */
export function authorize(claims, action) {
  // Il titolare cambia la propria password: nessun ruolo richiesto oltre
  // all'essere autenticato, è l'unica azione ammessa anche con la password
  // provvisoria ancora attiva (quel controllo resta a monte, nell'adapter).
  if (action === "accountChangeOwnPassword") return Boolean(claims);

  if (SOLO_SISTEMISTA.has(action)) return isSysadmin(claims);

  return null; // azione non gestita da questo modulo
}
