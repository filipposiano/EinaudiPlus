// Adapter verso le funzioni SQL del cambio biancheria (via PostgREST).
// Nessuna logica qui dentro — stesso principio di themeRepository.js.

import { rpc } from "../../../shared/db/rpcClient.js";

export const linenChangeRepository = {
  /** L'ancora grezza (data + tipo) così com'è salvata — per popolare il form admin. */
  async adminGet() {
    return rpc("linen_change_admin_get");
  },

  async setAnchor({ data, tipo }) {
    return rpc("linen_change_set_anchor", { p_anchor_date: data, p_anchor_type: tipo });
  },
};
