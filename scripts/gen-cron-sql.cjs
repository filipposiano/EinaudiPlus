#!/usr/bin/env node
/**
 * Genera l'SQL del cron con i valori reali gia' sostituiti, pronto da incollare
 * nel SQL Editor di Supabase.
 *
 *   node scripts/gen-cron-sql.cjs
 *   node scripts/gen-cron-sql.cjs https://altro.vercel.app
 *
 * Scrive in .env.cron-setup.sql, che e' fuori dal repository (.gitignore copre
 * .env.*): contiene il CRON_SECRET in chiaro e non deve finire in git.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.argv[2] || "https://einaudi-plus.vercel.app";

const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const secret = (env.match(/^CRON_SECRET=(.*)$/m) || [, ""])[1].trim();
if (!secret) { console.error("CRON_SECRET mancante in .env.local"); process.exit(1); }

const template = fs.readFileSync(path.join(ROOT, "supabase", "cron.sql"), "utf8");
const sql = template
  .replaceAll("{{APP_URL}}", BASE)
  .replaceAll("{{CRON_SECRET}}", secret);

const out = path.join(ROOT, ".env.cron-setup.sql");
fs.writeFileSync(out, sql, "utf8");

console.log("Scritto: .env.cron-setup.sql");
console.log("  URL:    " + BASE);
console.log("  Segreto: preso da .env.local (non stampato)");
console.log("");
console.log("Apri il file, copia tutto e incollalo nel SQL Editor di Supabase.");
console.log("Poi elimina il file: contiene il segreto in chiaro.");
