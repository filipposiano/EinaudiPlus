// Use-case: operazioni del sistemista sugli account (creazione, reset
// password, attivazione/disattivazione, cancellazione, elenco).
//
// Stessa validazione minima già presente nell'originale (password >= 8
// caratteri prima di toccare il database), ma come eccezione tipizzata
// invece di un `return fail(...)` che l'adapter doveva ricordarsi di gestire
// caso per caso.

import { ValidationError } from "../../../shared/errors/AppError.js";

const MIN_LEN = 8;

export async function createAccount({ username, password, ruolo, attore }, { accountRepository, hasher }) {
  if (password.length < MIN_LEN) throw new ValidationError(`la password deve avere almeno ${MIN_LEN} caratteri`);
  return accountRepository.create({
    username: username.trim(), passwordHash: hasher.hashPassword(password), ruolo, attore,
  });
}

export async function resetAccountPassword({ id, password }, { accountRepository, hasher }) {
  if (password.length < MIN_LEN) throw new ValidationError(`la password deve avere almeno ${MIN_LEN} caratteri`);
  return accountRepository.setPassword({ id, passwordHash: hasher.hashPassword(password) });
}

export async function setAccountActive({ id, attivo }, { accountRepository }) {
  return accountRepository.setActive({ id, attivo });
}

export async function deleteAccount({ id }, { accountRepository }) {
  return accountRepository.delete({ id });
}

export async function listAccounts(_input, { accountRepository }) {
  return accountRepository.list();
}
