// Superficie pubblica del modulo Identity — l'UNICO file che un altro modulo
// o un adapter in api/ può importare. Tutto il resto (domain/, application/,
// infrastructure/) è dettaglio interno: un import che scavalca questo file
// (es. `from "../modules/identity/infrastructure/accountRepository.js"`)
// va bloccato in CI con una regola eslint-boundaries (vedi
// ARCHITETTURA-ENTERPRISE.md, sezione 3 — "Regola di confine").

import { env } from "../../shared/config/env.js";
import { accountRepository } from "./infrastructure/accountRepository.js";
import * as hasher from "./infrastructure/passwordHasher.js";
import { issueToken as _issueToken, readToken as _readToken } from "./infrastructure/sessionToken.js";
import {
  setSessionCookie as _setSessionCookie,
  clearSessionCookie as _clearSessionCookie,
  readSessionCookie,
} from "./infrastructure/sessionCookie.js";
import { authenticate as _authenticate } from "./application/authenticate.js";
import { changeOwnPassword as _changeOwnPassword } from "./application/changeOwnPassword.js";
import {
  createAccount as _createAccount,
  resetAccountPassword as _resetAccountPassword,
  setAccountActive as _setAccountActive,
  deleteAccount as _deleteAccount,
  listAccounts as _listAccounts,
} from "./application/manageAccounts.js";

export { RUOLI, isValidRole, isSysadmin, isStaff, isDelegato, authorize } from "./domain/roles.js";
export { sessioneAncoraValida } from "./domain/sessionState.js";

// Le dipendenze reali (repository su Supabase, hasher scrypt) sono cablate
// qui una volta sola. I test invece chiamano gli use-case dallo strato
// application/ direttamente, iniettando dipendenze finte — questo file serve
// all'adapter HTTP, non ai test.
const deps = { accountRepository, hasher };

export function adminConfigured() {
  return Boolean(env.adminSessionSecret);
}

export async function authenticate(username, password) {
  return _authenticate({ username, password }, deps);
}

export function issueToken(username, role) {
  return _issueToken(username, role, env.adminSessionSecret);
}

export function readToken(token) {
  return _readToken(token, env.adminSessionSecret);
}

export function setSessionCookie(res, token) {
  return _setSessionCookie(res, token);
}

export function clearSessionCookie(res) {
  return _clearSessionCookie(res);
}

/** Le claim della sessione lette dal cookie della richiesta, o null. */
export function currentAdmin(req) {
  return readToken(readSessionCookie(req));
}

export async function changeOwnPassword(username, currentPassword, newPassword) {
  return _changeOwnPassword({ username, currentPassword, newPassword }, deps);
}

export async function createAccount(username, password, ruolo, attore) {
  return _createAccount({ username, password, ruolo, attore }, deps);
}

export async function resetAccountPassword(id, password) {
  return _resetAccountPassword({ id, password }, deps);
}

export async function setAccountActive(id, attivo) {
  return _setAccountActive({ id, attivo }, deps);
}

export async function deleteAccount(id) {
  return _deleteAccount({ id }, deps);
}

export async function listAccounts() {
  return _listAccounts({}, deps);
}

export async function accountByUsername(username) {
  return accountRepository.byUsername(username);
}

export const hashPassword = hasher.hashPassword;
export const verifyPassword = hasher.verifyPassword;
