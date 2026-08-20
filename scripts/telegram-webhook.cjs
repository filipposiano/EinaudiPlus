#!/usr/bin/env node
/**
 * Registra (o mostra) il webhook del bot Telegram.
 *
 *   node scripts/telegram-webhook.cjs               mostra lo stato
 *   node scripts/telegram-webhook.cjs --set         registra su produzione
 *   node scripts/telegram-webhook.cjs --set https://altro.vercel.app
 *   node scripts/telegram-webhook.cjs --delete      rimuove
 *
 * Legge TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET da .env.local.
 *
 * Nota: Telegram ammette in secret_token solo A-Z a-z 0-9 _ e -. Con altri
 * caratteri la registrazione fallisce e il bot resta muto senza segnalarlo.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [, ""])[1].trim();

const TOKEN = g("TELEGRAM_BOT_TOKEN");
const SECRET = g("TELEGRAM_WEBHOOK_SECRET");
if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN mancante in .env.local"); process.exit(1); }

const API = "https://api.telegram.org/bot" + TOKEN;
const call = async (m, body) => {
  const r = await fetch(API + "/" + m, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
};

(async () => {
  const args = process.argv.slice(2);
  const base = args.find((a) => a.startsWith("http")) || "https://einaudi-plus.vercel.app";

  if (args.includes("--delete")) {
    console.log(JSON.stringify(await call("deleteWebhook", { drop_pending_updates: true })));
    return;
  }

  if (args.includes("--set")) {
    if (SECRET && !/^[A-Za-z0-9_-]{1,256}$/.test(SECRET)) {
      console.error("TELEGRAM_WEBHOOK_SECRET contiene caratteri non ammessi da Telegram.");
      console.error("Consentiti solo A-Z a-z 0-9 _ e -");
      process.exit(1);
    }

    const res = await call("setWebhook", {
      url: base + "/api/telegram",
      secret_token: SECRET || undefined,
      allowed_updates: ["message"],   // solo i messaggi: il resto sarebbe rumore
      drop_pending_updates: true,     // scarta l'arretrato accumulato mentre era spento
    });
    console.log("setWebhook: " + JSON.stringify(res));
    if (!res.ok) process.exit(1);
    console.log("");
  }

  const info = (await call("getWebhookInfo")).result || {};
  const me = (await call("getMe")).result || {};

  console.log("bot:            @" + (me.username || "?") + "  (" + (me.first_name || "") + ")");
  console.log("url:            " + (info.url || "(nessuno)"));
  console.log("segreto:        " + (info.has_custom_certificate === undefined ? "?" : (SECRET ? "impostato" : "assente")));
  console.log("in attesa:      " + (info.pending_update_count ?? "?"));
  if (info.last_error_message) {
    console.log("ULTIMO ERRORE:  " + info.last_error_message +
                "  (" + new Date((info.last_error_date || 0) * 1000).toLocaleString("it-IT") + ")");
  }
})().catch((e) => { console.error("ERRORE: " + e.message); process.exit(1); });
