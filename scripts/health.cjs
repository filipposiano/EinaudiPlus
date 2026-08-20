#!/usr/bin/env node
/**
 * Interroga /api/health su un deployment e stampa il referto.
 *
 *   node scripts/health.cjs                        (produzione)
 *   node scripts/health.cjs https://altro.vercel.app
 *
 * Legge CRON_SECRET da .env.local, che e' cio' che protegge l'endpoint.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.argv[2] || "https://einaudi-plus.vercel.app";

const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const secret = (env.match(/^CRON_SECRET=(.*)$/m) || [, ""])[1].trim();
if (!secret) {
  console.error("CRON_SECRET mancante in .env.local");
  process.exit(1);
}

(async () => {
  const res = await fetch(BASE + "/api/health", {
    headers: { "x-cron-secret": secret },
  });

  if (res.status === 404) {
    console.log("HTTP 404 — /api/health non e' ancora online su " + BASE);
    console.log("Serve un deploy che includa il commit dell'endpoint.");
    process.exit(2);
  }
  if (res.status === 401) {
    console.log("HTTP 401 — CRON_SECRET diverso fra locale e Vercel.");
    process.exit(3);
  }

  const data = await res.json();

  console.log("=== DATABASE ===");
  console.log(JSON.stringify(data.database, null, 2));

  console.log("");
  console.log("=== VARIABILI ===");
  const mancanti = [];
  for (const v of data.variabili || []) {
    if (!v.presente) { mancanti.push(v.nome); console.log("  MANCA   " + v.nome); }
    else {
      const extra = [
        "len " + v.lunghezza,
        v.valore ? "= " + v.valore : v.inizia_per ? 'inizia "' + v.inizia_per + '"' : null,
        v.attenzione ? "!! " + v.attenzione : null,
      ].filter(Boolean).join("  ");
      console.log("  ok      " + v.nome.padEnd(24) + extra);
    }
  }

  console.log("");
  if (mancanti.length) {
    console.log("MANCANTI SU VERCEL: " + mancanti.join(", "));
    console.log("Controlla che siano spuntate per l'ambiente Production, poi rideploia.");
  } else if (!data.database?.ok) {
    console.log("Le variabili ci sono ma il database rifiuta la connessione.");
    console.log("Guarda lo status e la risposta qui sopra.");
  } else {
    console.log("Tutto a posto.");
  }
})().catch((e) => { console.error("ERRORE: " + e.message); process.exit(1); });
