import { rpc } from "../../../shared/db/rpcClient.js";

export const opsRepository = {
  async overview() {
    return rpc("admin_overview");
  },
  async recurringList() {
    return rpc("recurring_list");
  },
  async recurringSetActive({ id, active }) {
    return rpc("recurring_set_active", { p_id: id, p_active: active });
  },
  async recurringDelete({ id }) {
    return rpc("recurring_delete", { p_id: id });
  },
  async applyRecurring({ offset }) {
    return rpc("apply_recurring", { p_offset: offset });
  },
  async purge({ scope, sala }) {
    return rpc("sysadmin_purge", { p_scope: scope, p_sala: sala });
  },
  async counts() {
    return rpc("sysadmin_conteggi");
  },
};
