#!/usr/bin/env node
/**
 * Applica SQL al database Supabase tramite la Management API.
 *
 *   node scripts/db.cjs apply supabase/schema.sql
 *   node scripts/db.cjs query "select count(*) from laundry"
 *
 * Legge SUPABASE_PROJECT_REF e SUPABASE_ACCESS_TOKEN da .env.local.
 * Il token e' uno strumento di sviluppo: non va nelle env var di Vercel.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function env() {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) throw new Error(".env.local non trovato");
  const text = fs.readFileSync(file, "utf8");
  const get = (k) => {
    const m = text.match(new RegExp("^" + k + "=(.*)$", "m"));
    return m ? m[1].trim() : "";
  };
  const ref = get("SUPABASE_PROJECT_REF");
  const token = get("SUPABASE_ACCESS_TOKEN");
  if (!ref) throw new Error("SUPABASE_PROJECT_REF mancante in .env.local");
  if (!token) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN mancante in .env.local.\n" +
        "Generalo su https://supabase.com/dashboard/account/tokens"
    );
  }
  return { ref, token };
}

async function runSql(sql) {
  const { ref, token } = env();
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    }
  );

  const raw = await res.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }

  if (!res.ok) {
    const msg =
      (body && (body.message || body.error)) || raw || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);

  if (cmd === "apply") {
    if (!arg) throw new Error("uso: node scripts/db.cjs apply <file.sql>");
    const file = path.resolve(ROOT, arg);
    const sql = fs.readFileSync(file, "utf8");
    process.stdout.write(`Applico ${arg} (${sql.length} caratteri)... `);
    await runSql(sql);
    console.log("OK");
    return;
  }

  if (cmd === "query") {
    if (!arg) throw new Error('uso: node scripts/db.cjs query "<sql>"');
    const out = await runSql(arg);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log("uso:\n  node scripts/db.cjs apply <file.sql>\n  node scripts/db.cjs query \"<sql>\"");
  process.exit(1);
}

main().catch((e) => {
  console.error("ERRORE: " + e.message);
  process.exit(1);
});
