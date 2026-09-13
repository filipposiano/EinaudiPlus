// Use-case: riconosce utente e password, torna il ruolo o null.
//
// Logica pura orchestrata su due porte iniettate (repository, hasher): nessun
// import diretto di rpc() o di crypto qui dentro. È quello che la rende
// testabile con un repository finto e verificabile in isolamento, cosa
// impossibile oggi con authenticate() dentro api/_lib/auth.js (richiede un
// database Supabase vero per essere eseguita anche solo una volta).

import { HASH_FASULLO } from "../infrastructure/passwordHasher.js";

/**
 * @param {{username: string, password: string}} input
 * @param {{accountRepository: object, hasher: {verifyPassword: Function}}} deps
 * @returns {Promise<string|null>} il ruolo, o null se le credenziali non sono valide
 */
export async function authenticate({ username, password }, { accountRepository, hasher }) {
  let row = null;
  try {
    row = await accountRepository.byUsername(username);
  } catch {
    return null; // database muto: accesso rifiutato, niente rete di sicurezza alternativa
  }

  if (!row?.id) {
    // Utente inesistente: si passa comunque da scrypt, con lo stesso costo di
    // una password sbagliata su un account vero, così il tempo di risposta
    // non rivela quali username esistono (mitigazione user enumeration).
    hasher.verifyPassword(password, HASH_FASULLO);
    return null;
  }

  if (!row.attivo) return null;
  return hasher.verifyPassword(password, row.password_hash) ? row.ruolo : null;
}
