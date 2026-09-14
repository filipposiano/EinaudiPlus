// Adapter verso le funzioni SQL di notifiche/iscrizioni/promemoria.
// Nessuna logica qui dentro — vedi laundryRepository.js per lo stesso
// principio applicato per primo.

import { rpc } from "../../../shared/db/rpcClient.js";

export const notificationsRepository = {
  async upsertPushSub({ room, endpoint, p256dh, auth }) {
    return rpc("upsert_push_sub", { p_room: room, p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth });
  },

  async removePushSub({ endpoint }) {
    return rpc("remove_push_sub", { p_endpoint: endpoint });
  },

  async createTelegramCode({ room }) {
    return rpc("telegram_create_code", { p_room: room });
  },

  async telegramLink({ code, chatId }) {
    return rpc("telegram_link", { p_code: code, p_chat_id: chatId });
  },

  async telegramUnlink({ chatId }) {
    return rpc("telegram_unlink", { p_chat_id: chatId });
  },

  async adminListPushSubs() {
    return rpc("sysadmin_push_subs");
  },

  async adminDeletePushSub({ id }) {
    return rpc("sysadmin_delete_push_sub", { p_id: id });
  },

  async adminListTelegramSubs() {
    return rpc("sysadmin_telegram_subs");
  },

  async adminDeleteTelegramSub({ id }) {
    return rpc("sysadmin_delete_telegram_sub", { p_id: id });
  },

  async allPushSubs({ room }) {
    return rpc("sysadmin_all_push_subs", { p_room: room });
  },

  async allTelegramSubs({ room }) {
    return rpc("sysadmin_all_telegram_subs", { p_room: room });
  },

  async prunePushSubs({ ids }) {
    return rpc("sysadmin_prune_push_subs", { p_ids: ids });
  },

  /** Chi avvisare per una camera — nome storico dell'RPC (nata per le bici),
   *  in realtà interroga le stesse iscrizioni push/Telegram di questo modulo. */
  async notifyTargetsForRoom(room) {
    return rpc("bike_notify_targets", { p_room: room });
  },

  async claimDueReminders({ graceMin }) {
    return rpc("claim_due_reminders", { p_grace_min: graceMin });
  },

  async reportReminderResults({ gone, stats }) {
    return rpc("report_reminder_results", { p_gone: gone, p_stats: stats });
  },

  async pruneNetResponses() {
    return rpc("prune_net_responses");
  },
};
