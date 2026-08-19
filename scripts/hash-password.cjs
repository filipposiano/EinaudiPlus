#!/usr/bin/env node
/**
 * Genera l'hash della password admin e lo scrive in .env.local.
 *
 *   node scripts/hash-password.cjs "la-password"
 *
 * La password non viene mai stampata ne' salvata in chiaro: nel file finisce
 * solo l'hash, che e' quello che va poi copiato nelle env var di Vercel.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const ROOT = path.resolve(__dirname, "..");

const password = process.argv[2];
if (!password) {
  console.error('uso: node scripts/hash-password.cjs "la-password"');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
const hash = `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;

const file = path.join(ROOT, ".env.local");
let text = fs.readFileSync(file, "utf8");
const re = /^ADMIN_PASSWORD_HASH=.*$/m;
text = re.test(text)
  ? text.replace(re, "ADMIN_PASSWORD_HASH=" + hash)
  : text + "\nADMIN_PASSWORD_HASH=" + hash;
fs.writeFileSync(file, text, "utf8");

console.log("Hash scritto in .env.local (ADMIN_PASSWORD_HASH).");
console.log("Lunghezza hash: " + hash.length + " caratteri.");
console.log("La password in chiaro non e' stata salvata da nessuna parte.");
