#!/usr/bin/env node
/**
 * Registra il menu dei comandi del bot Telegram.
 *
 *   node scripts/telegram-comandi.cjs           mostra quelli attuali
 *   node scripts/telegram-comandi.cjs --scrivi  li aggiorna
 *
 * È il menu che Telegram propone digitando "/" nella chat. Non ha niente a che
 * vedere con i comandi che il bot SA gestire (quelli stanno in api/telegram.js):
 * è solo la vetrina. Per questo si disallinea facilmente — /stop funzionava da
 * sempre ma non comparendo in elenco era, di fatto, invisibile: chi voleva
 * smettere di ricevere i promemoria non aveva modo di scoprirlo se non
 * leggendo il messaggio di aiuto per intero.
 *
 * Va rilanciato a mano quando si aggiunge o si toglie un comando: Telegram
 * tiene questo elenco sui suoi server, non lo deduce dal nostro codice.
 */
const fs = require("fs");
const path = require("path");

// I comandi che api/telegram.js gestisce davvero. Tenere le due liste vicine
// non basta a garantirne l'allineamento, ma almeno rende evidente il confronto.
const COMANDI = [
  { command: "start", description: "Collega la tua camera e ricevi i promemoria dei turni" },
  { command: "stop",  description: "Smetti di ricevere i promemoria" },
];

function leggiToken() {
  const f = path.resolve(__dirname, "..", ".env.local");
  const m = fs.readFileSync(f, "utf8").match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
  if (!m) throw new Error("TELEGRAM_BOT_TOKEN non trovato in .env.local");
  return m[1].trim();
}

async function main() {
  const token = leggiToken();
  const api = (m, body) =>
    fetch(`https://api.telegram.org/bot${token}/${m}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then((r) => r.json());

  const prima = await api("getMyCommands");
  console.log("Comandi attualmente registrati:");
  for (const c of prima.result || []) console.log(`  /${c.command} — ${c.description}`);
  if (!(prima.result || []).length) console.log("  (nessuno)");

  if (!process.argv.includes("--scrivi")) {
    console.log("\nDa registrare:");
    for (const c of COMANDI) console.log(`  /${c.command} — ${c.description}`);
    console.log("\nRilancia con --scrivi per applicare.");
    return;
  }

  const out = await api("setMyCommands", { commands: COMANDI });
  if (!out.ok) throw new Error("setMyCommands fallito: " + JSON.stringify(out));

  const dopo = await api("getMyCommands");
  console.log("\nOra registrati:");
  for (const c of dopo.result || []) console.log(`  /${c.command} — ${c.description}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
