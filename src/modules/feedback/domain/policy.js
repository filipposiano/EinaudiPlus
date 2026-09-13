// Policy di autorizzazione del modulo Feedback.
//
// Macchine e segnalazioni restano affari di FDO e sistemista: lo staff
// prenota e libera turni per conto della Direzione come l'FDO, ma non deve
// vedere né toccare le segnalazioni dei residenti.

import { isStaff } from "../../identity/index.js";

const AZIONI_FEEDBACK = new Set(["feedback", "markFeedback"]);
const VIETATE_A_STAFF = new Set(["feedback", "markFeedback"]);

export function authorize(claims, action) {
  if (!AZIONI_FEEDBACK.has(action)) return null;
  if (!claims) return false;
  if (VIETATE_A_STAFF.has(action) && isStaff(claims)) return false;
  return true;
}
