// Use-case: il titolare cambia la propria password.
//
// È l'unica azione ammessa a chi ha ancora la password provvisoria (vedi
// domain/roles.js e il controllo a monte nell'adapter admin/data.js
// originale): serve la password attuale per dimostrare di essere lui, non
// basta una sessione valida.

import { ValidationError } from "../../../shared/errors/AppError.js";

const MIN_LEN = 8;

/**
 * @param {{username: string, currentPassword: string, newPassword: string}} input
 * @param {{accountRepository: object, hasher: {verifyPassword: Function, hashPassword: Function}}} deps
 */
export async function changeOwnPassword(
  { username, currentPassword, newPassword },
  { accountRepository, hasher },
) {
  if (newPassword.length < MIN_LEN) {
    throw new ValidationError(`la nuova password deve avere almeno ${MIN_LEN} caratteri`);
  }

  const row = await accountRepository.byUsername(username);
  if (!row?.id) throw new ValidationError("account non trovato");
  if (!hasher.verifyPassword(currentPassword, row.password_hash)) {
    throw new ValidationError("password attuale non corretta");
  }

  return accountRepository.setOwnPassword({ username, passwordHash: hasher.hashPassword(newPassword) });
}
