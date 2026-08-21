#!/usr/bin/env node
/**
 * Genera l'hash di una password admin e lo scrive in .env.local.
 *
 *   node scripts/hash-password.cjs fdo        "la-password"
 *   node scripts/hash-password.cjs staff      "la-password"
 *   node scripts/hash-password.cjs sistemista "la-password"
 *
 * Il ruolo va detto SEMPRE, e per un motivo pratico: prima era facoltativo e
 * senza di esso lo script scriveva su FDO_PASSWORD_HASH. Generando l'hash per
 * un altro account ci si ritrovava la password della portineria sovrascritta —
 * senza che nulla lo dicesse, finche' non si provava ad entrare.
 *
 * La password non viene mai stampata ne' salvata in chiaro: nel file finisce
 * solo l'hash, che e' quello che va poi copiato nelle env var di Vercel.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const ROOT = path.resolve(__dirname, "..");

const VARIABILE = {
  fdo:        "FDO_PASSWORD_HASH",
  staff:      "STAFF_PASSWORD_HASH",
  sistemista: "SYSADMIN_PASSWORD_HASH",
};

const ruolo = process.argv[2];
const password = process.argv[3];
const target = VARIABILE[ruolo];

if (!target || !password) {
  console.error('uso: node scripts/hash-password.cjs <fdo|staff|sistemista> "la-password"');
  if (ruolo && !target) console.error(`ruolo sconosciuto: "${ruolo}"`);
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
