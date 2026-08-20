#!/usr/bin/env node
/**
 * Verifica di fumo su un deployment reale.
 *
 *   node scripts/smoke.cjs                          (produzione)
 *   node scripts/smoke.cjs https://altro.vercel.app
 *
 * Di default fa SOLO letture: gira su produzione, dove i dati sono di persone
 * vere. Con --write aggiunge una prenotazione su uno slot casuale e la cancella
 * subito dopo.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.argv.find((a) => a.startsWith("http")) || "https://einaudi-plus.vercel.app";
const WRITE = process.argv.includes("--write");

const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [, ""])[1].trim();
const TOKEN = g("APP_TOKEN");

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log("  ok    " + n)) : (fail++, console.log("  FALLA " + n + "  " + d)); };

const get = async (p) => {
  const t0 = Date.now();
  const r = await fetch(BASE + p);
  const b = await r.text();
  let j = null; try { j = JSON.parse(b); } catch {}
  return { status: r.status, body: j, raw: b, ms: Date.now() - t0 };
};
const post = async (p, body, headers = {}) => {
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8", ...headers },
    body: JSON.stringify(body),
  });
  const b = await r.text();
  let j = null; try { j = JSON.parse(b); } catch {}
  return { status: r.status, body: j, raw: b, headers: r.headers };
};

(async () => {
  console.log("Verifico " + BASE + (WRITE ? "  (con scrittura)" : "  (sola lettura)"));

  console.log("\n── Lavanderia ──");
  const s1 = await get(`/api/laundry?token=${encodeURIComponent(TOKEN)}&room=112`);
  check("snapshot valentino", s1.body?.ok === true, `HTTP ${s1.status} ${s1.raw.slice(0, 90)}`);
  check("  19 turni", s1.body?.slots === 19);
  check("  7 giorni", Object.keys(s1.body?.week || {}).length === 7);
  check("  6 macchine", Object.keys(s1.body?.status || {}).length === 6);
  console.log("        risposta in " + s1.ms + "ms");

  const s2 = await get(`/api/laundry?token=${encodeURIComponent(TOKEN)}&room=42`);
  check("snapshot sezione", s2.body?.ok === true);
  check("  solo W-A operativa", s2.body?.status?.["W-A"] === "ok" && s2.body?.status?.["W-B"] === "oos");

  check("token errato respinto", (await get("/api/laundry?token=no&room=112")).status === 401);

  console.log("\n── Sale ──");
  for (const sp of ["cinema", "music"]) {
    const r = await get(`/api/rooms?token=${encodeURIComponent(TOKEN)}&space=${sp}`);
    check(sp, r.body?.ok === true && Array.isArray(r.body.bookings),
      `HTTP ${r.status} ${r.raw.slice(0, 90)}`);
  }

  console.log("\n── Admin ──");
  const a = await get("/api/admin/auth");
  check("stato sessione", a.body?.ok === true && a.body.logged === false);
  const bad = await post("/api/admin/auth", { action: "login", username: "admin", password: "no" },
    { "Content-Type": "application/json" });
  check("password errata respinta", bad.status === 401 && bad.body?.error === "credenziali non valide");
  check("dati admin senza sessione respinti",
    (await post("/api/admin/data", { action: "overview" }, { "Content-Type": "application/json" })).status === 401);

  console.log("\n── Cron ──");
  check("senza segreto respinto", (await post("/api/cron", {})).status === 401);
  const cron = await post("/api/cron", {}, { "x-cron-secret": g("CRON_SECRET") });
  check("tick autenticato", cron.body?.ok === true, JSON.stringify(cron.body));
  if (cron.body?.ok) console.log("        " + JSON.stringify(cron.body));

  console.log("\n── Bundle ──");
  const html = await (await fetch(BASE + "/?cb=" + Date.now())).text();
  const js = [...html.matchAll(/src="([^"]+\.js)"/g)].map((x) => x[1])[0];
  const code = await (await fetch(BASE + js)).text();
  check("nessun URL Apps Script", !/script\.google\.com/.test(code));
  check("punta a /api/laundry", code.includes("/api/laundry"));
  check("chiave VAPID allineata a Vercel", code.includes("BFhjaxEm"),
    "il bundle usa una chiave diversa da VAPID_PUBLIC_KEY");
  check("pannello /admin raggiungibile", (await fetch(BASE + "/admin")).status === 200);

  if (WRITE) {
    console.log("\n── Scrittura (e pulizia) ──");
    const room = "9999";
    const day = 6, slot = 18, machine = "W-C";   // domenica sera, ultimo turno
    const b = await post("/api/laundry", { token: TOKEN, action: "book", day, slot, machine, room });
    check("prenotazione", b.body?.ok === true, JSON.stringify(b.body).slice(0, 120));
    if (b.body?.ok) {
      const dup = await post("/api/laundry", { token: TOKEN, action: "book", day, slot, machine, room: "9998" });
      check("conflitto rilevato", dup.body?.error === "occupata" && dup.body?.by === room);
      const c = await post("/api/laundry", { token: TOKEN, action: "clear", day, slot, machine, room });
      check("cancellazione", c.body?.ok === true);
      check("slot liberato", c.body?.week?.[String(day)]?.[String(slot)] === undefined);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERRORE: " + e.message); process.exit(1); });
