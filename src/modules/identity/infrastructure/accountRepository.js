// Adapter verso la tabella `admin_account` (via funzioni SQL / PostgREST).
//
// Nessuna logica qui dentro: solo la traduzione fra il linguaggio del
// dominio (accountByUsername, createAccount...) e le funzioni RPC esistenti.
// Lo strato application/ dipende da QUESTA interfaccia, non da rpc() o da
// Supabase direttamente — è quello che rende authenticate.js testabile con
// un repository finto, senza rete né database (vedi tests/unit/identity.test.mjs).

import { rpc } from "../../../shared/db/rpcClient.js";

export const accountRepository = {
  async byUsername(username) {
    return rpc("account_by_username", { p_username: username });
  },

  async list() {
    return rpc("account_list");
  },

  async create({ username, passwordHash, ruolo, attore }) {
    return rpc("account_create", {
      p_username: username, p_password_hash: passwordHash, p_ruolo: ruolo, p_attore: attore,
    });
  },

  async setPassword({ id, passwordHash }) {
    return rpc("account_set_password", { p_id: id, p_password_hash: passwordHash });
  },

  async setOwnPassword({ username, passwordHash }) {
    return rpc("account_set_own_password", { p_username: username, p_password_hash: passwordHash });
  },

  async setActive({ id, attivo }) {
    return rpc("account_set_active", { p_id: id, p_attivo: attivo });
  },

  async delete({ id }) {
    return rpc("account_delete", { p_id: id });
  },
};
