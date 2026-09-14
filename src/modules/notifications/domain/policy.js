// Policy di autorizzazione del modulo Notifications — stesso principio
// degli altri moduli. Tutte le azioni amministrative (gestione iscrizioni,
// broadcast) sono riservate al sistemista.

import { isSysadmin } from "../../identity/index.js";

const AZIONI_NOTIFICATIONS = new Set([
  "pushSubs", "deletePushSub", "telegramSubs", "deleteTelegramSub", "broadcastPush",
]);

export function authorize(claims, action) {
  if (!AZIONI_NOTIFICATIONS.has(action)) return null;
  if (!claims) return false;
  return isSysadmin(claims);
}
