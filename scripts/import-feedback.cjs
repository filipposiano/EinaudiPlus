#!/usr/bin/env node
/**
 * Importa lo storico delle segnalazioni dal foglio "Feedback".
 *
 *   node scripts/import-feedback.cjs feedback.csv
 *
 * Il CSV si esporta da Google Sheets con File -> Scarica -> CSV.
 * Colonne attese, nell'ordine del foglio: data, camera, messaggio.
 *
 * NOTA: le subscription push NON si importano. Sono legate alla vecchia chiave
 * VAPID, che e' cambiata: il servizio push rifiuterebbe ogni invio con 403.
 * I dispositivi si ri-registrano da soli al primo avvio, via refreshSubscription().
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function env(key) {
  const text = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const m = text.match(new RegExp("^" + key + "=(.*)$", "m"));
  return m ? m[1].trim() : "";
}

/** Parser CSV minimale ma corretto su virgolette e virgole dentro al testo. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("uso: node scripts/import-feedback.cjs <file.csv>");
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(path.resolve(file), "utf8"));
  const start = /data|date/i.test(rows[0]?.[0] || "") ? 1 : 0;   // salta l'intestazione

  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL o SUPABASE_SECRET_KEY mancanti in .env.local");

  let ok = 0, skip = 0;
  for (const r of rows.slice(start)) {
    const [when, room, body] = r;
    const text = String(body || "").trim();
    if (!text) { skip++; continue; }

    const when2 = new Date(when);
    const res = await fetch(`${url}/rest/v1/feedback`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        // L'apostrofo iniziale e' un residuo dell'anti-formula-injection dei fogli.
        room: String(room || "").replace(/^'/, "").trim() || null,
        body: text.replace(/^'/, "").slice(0, 2000),
        created_at: isNaN(when2.getTime()) ? new Date().toISOString() : when2.toISOString(),
        handled_at: new Date().toISOString(),   // lo storico entra gia' chiuso
      }),
    });

    if (res.ok) ok++;
    else { skip++; console.error("  scartata: " + (await res.text()).slice(0, 120)); }
  }

  console.log(`Importate ${ok} segnalazioni, ${skip} scartate.`);
}

main().catch((e) => { console.error("ERRORE: " + e.message); process.exit(1); });
