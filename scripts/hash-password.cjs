#!/usr/bin/env node
/**
 * Genera l'hash di una password admin e lo scrive in .env.local.
 *
 *   node scripts/hash-password.cjs "la-password"              -> FDO_PASSWORD_HASH
 *   node scripts/hash-password.cjs "la-password" sistemista   -> SYSADMIN_PASSWORD_HASH
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
const target = process.argv[3] === "sistemista" ? "SYSADMIN_PASSWORD_HASH" : "FDO_PASSWORD_HASH";

if (!password) {
  console.error('uso: node scripts/hash-password.cjs "la-password" [sistemista]');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
const hash = `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;

const file = path.join(ROOT, ".env.local");
let text = fs.readFileSync(file, "utf8");
const re = new RegExp(`^${target}=.*$`, "m");
text = re.test(text)
  ? text.replace(re, target + "=" + hash)
  : text + "\n" + target + "=" + hash;
fs.writeFileSync(file, text, "utf8");

console.log(`Hash scritto in .env.local (${target}).`);
console.log("Lunghezza hash: " + hash.length + " caratteri.");
console.log("La password in chiaro non e' stata salvata da nessuna parte.");
