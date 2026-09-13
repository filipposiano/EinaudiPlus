// Adapter verso le funzioni SQL del tema stagionale (via PostgREST).
// Nessuna logica qui dentro — vedi laundryRepository.js per lo stesso
// principio applicato per primo.

import { rpc } from "../../../shared/db/rpcClient.js";

export const themeRepository = {
  async get() {
    return rpc("app_theme_get");
  },

  async set(tema) {
    return rpc("sysadmin_set_theme", { p_tema: tema });
  },
};
