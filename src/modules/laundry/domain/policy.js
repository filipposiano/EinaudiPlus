// Policy di autorizzazione delle azioni amministrative che appartengono a
// QUESTO modulo — stesso principio di identity/domain/roles.js: la regola
// vive accanto alle azioni che descrive, non in un Set() centrale mantenuto
// a mano nell'adapter (vedi audit finding #3 in
// refactor-enterprise/ARCHITETTURA-ENTERPRISE.md).
//
// isStaff() è un concetto di Identity (chi è questo utente), non di
// Laundry: importarlo dalla superficie pubblica del modulo Identity è
// esattamente la dipendenza fra moduli che l'architettura ammette — un
// modulo può usare un altro modulo solo tramite il suo index.ts.

import { isStaff, isSysadmin } from "../../identity/index.js";

/** Azioni amministrative di dominio Laundry, riconosciute da authorize(). */
const AZIONI_LAUNDRY = new Set([
  "week", "setMachineStatus", "deleteBooking", "forceBook",
  "bookDirezione", "clearDirezione", "recurringAddLaundry",
]);

/**
 * Lo stato guasto/funzionante di una macchina resta affare della portineria
 * (FDO) e del sistemista: lo staff prenota e libera turni per conto della
 * Direzione come l'FDO, ma non tocca lo stato delle macchine (vedi
 * VIETATE_A_STAFF nell'admin/data.js originale).
 */
const VIETATE_A_STAFF = new Set(["setMachineStatus"]);

/**
 * Le regole ricorrenti sono riservate al sistemista in TUTTO il pannello —
 * la stessa regola che common-spaces/domain/policy.js applica alla sua
 * gemella `recurringAddSpace`, e che le altre azioni sulle ricorrenti
 * (elencare, sospendere, cancellare, applicare) applicano dal modulo Ops.
 *
 * Qui mancava: `recurringAddLaundry` cadeva sul `return true` finale ed era
 * concessa anche a FDO e staff. Dalla UI non si arrivava — la scheda
 * Ricorrenti è riservata al sistemista — ma l'endpoint sì, e nascondere una
 * voce non è un'autorizzazione. Una regola creata così prenota uno slot ogni
 * settimana per sempre, e chi l'ha creata non può né vederla né sospenderla
 * né cancellarla: quelle azioni sono da sistemista.
 */
const SOLO_SISTEMISTA = new Set(["recurringAddLaundry"]);

/**
 * Decide se `claims` può eseguire `action`.
 *
 * Torna `null` quando l'azione non appartiene a questo modulo (non "vietato",
 * "non è affar mio" — il chiamante continua a cercare altrove); `false`/`true`
 * quando la decisione è di competenza di Laundry.
 */
export function authorize(claims, action) {
  if (!AZIONI_LAUNDRY.has(action)) return null;
  if (!claims) return false;
  if (SOLO_SISTEMISTA.has(action)) return isSysadmin(claims);
  if (VIETATE_A_STAFF.has(action) && isStaff(claims)) return false;
  return true;
}
