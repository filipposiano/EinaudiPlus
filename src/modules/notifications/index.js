// Superficie pubblica del modulo Notifications — l'UNICO file che un altro
// modulo o un adapter in api/ può importare.
//
// Dominio coperto: iscrizioni push, collegamento Telegram, promemoria
// automatici (cron), broadcast manuale del sistemista, e "avvisa una
// camera" (usato da Bikes). Nessuna azione qui possiede la sua griglia di
// autorizzazione lato pannello se non tramite domain/policy.js.

import { notificationsRepository } from "./infrastructure/notificationsRepository.js";
import { webPushSender } from "./infrastructure/webPushSender.js";
import { telegramSender } from "./infrastructure/telegramSender.js";
import { checkRateLimit } from "../../shared/http/rateLimit.js";

import { subscribePush as _subscribePush } from "./application/subscribePush.js";
import { unsubscribePush as _unsubscribePush } from "./application/unsubscribePush.js";
import { createTelegramCode as _createTelegramCode } from "./application/createTelegramCode.js";
import { linkTelegramByCode as _linkTelegramByCode } from "./application/linkTelegramByCode.js";
import { unlinkTelegram as _unlinkTelegram } from "./application/unlinkTelegram.js";
import { sendDueReminders as _sendDueReminders } from "./application/sendDueReminders.js";
import { notifyRoom as _notifyRoom } from "./application/notifyRoom.js";
import { adminListPushSubs as _adminListPushSubs } from "./application/adminListPushSubs.js";
import { adminDeletePushSub as _adminDeletePushSub } from "./application/adminDeletePushSub.js";
import { adminListTelegramSubs as _adminListTelegramSubs } from "./application/adminListTelegramSubs.js";
import { adminDeleteTelegramSub as _adminDeleteTelegramSub } from "./application/adminDeleteTelegramSub.js";
import { adminBroadcast as _adminBroadcast } from "./application/adminBroadcast.js";

export { authorize } from "./domain/policy.js";
export { endpointAllowed } from "./domain/channels.js";

const deps = { notificationsRepository, pushSender: webPushSender, telegramSender, checkRateLimit };

export function pushConfigured() {
  return webPushSender.configured();
}

export function telegramConfigured() {
  return telegramSender.configured();
}

export async function subscribePush(input) {
  return _subscribePush(input, deps);
}

export async function unsubscribePush(endpoint) {
  return _unsubscribePush({ endpoint }, deps);
}

export async function createTelegramCode(room) {
  return _createTelegramCode({ room }, deps);
}

export async function linkTelegramByCode(code, chatId) {
  return _linkTelegramByCode({ code, chatId }, deps);
}

export async function unlinkTelegram(chatId) {
  return _unlinkTelegram({ chatId }, deps);
}

export async function sendDueReminders(graceMin) {
  return _sendDueReminders({ graceMin }, deps);
}

/** Avvisa una camera su tutti i canali configurati (usato da Bikes). */
export async function notifyRoom(room, title, body, tag) {
  return _notifyRoom({ room, title, body, tag }, deps);
}

export async function adminListPushSubs() {
  return _adminListPushSubs({}, deps);
}

export async function adminDeletePushSub(id) {
  return _adminDeletePushSub({ id }, deps);
}

export async function adminListTelegramSubs() {
  return _adminListTelegramSubs({}, deps);
}

export async function adminDeleteTelegramSub(id) {
  return _adminDeleteTelegramSub({ id }, deps);
}

export async function adminBroadcast(input) {
  return _adminBroadcast(input, deps);
}

/** Risposta testuale semplice del bot (aiuto, conferme) — nessuna logica,
 *  solo un passaggio verso il sender Telegram. */
export async function sendPlainTelegramMessage(chatId, text) {
  return telegramSender.sendPlain(chatId, text);
}
