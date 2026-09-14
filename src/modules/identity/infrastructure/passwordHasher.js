// scrypt invece di bcrypt: nella libreria standard di Node, zero dipendenze
// da mantenere, nessun modulo nativo che si rompe in build (motivazione
// invariata rispetto ad api/_lib/auth.js originale — stessa scelta, stessi
// parametri, stesso comportamento).

import crypto from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, keyHex] = String(stored || "").split("$");
    if (scheme !== "scrypt" || !saltHex || !keyHex) return false;

    const expected = Buffer.from(keyHex, "hex");
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, SCRYPT);
    // timingSafeEqual e non ===: il confronto ingenuo esce al primo byte
    // diverso, e il tempo impiegato rivela quanti caratteri erano giusti.
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// Hash fisso, di nessun account: serve a far passare verifyPassword() dal
// suo ramo più lento (scrypt) anche quando l'username cercato non esiste,
// così un utente sconosciuto non risponde più in fretta di uno esistente
// con password sbagliata (mitigazione di user enumeration via timing).
export const HASH_FASULLO = `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`;
