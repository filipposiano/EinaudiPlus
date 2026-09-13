import { rpc } from "../../../shared/db/rpcClient.js";

export const feedbackRepository = {
  async add(room, text) {
    return rpc("add_feedback", { p_room: room, p_text: text });
  },
  async list({ onlyOpen, limit }) {
    return rpc("admin_feedback", { p_only_open: onlyOpen, p_limit: limit });
  },
  async markHandled({ id, handled }) {
    return rpc("admin_mark_feedback", { p_id: id, p_handled: handled });
  },
};
