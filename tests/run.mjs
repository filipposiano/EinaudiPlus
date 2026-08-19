// Verifica end-to-end del backend, contro il database vero.
//
//   npm test
//
// Gira gli handler serverless in-process, senza bisogno di `vercel dev`:
// simula gli oggetti req/res come li passa Vercel, incluso il corpo text/plain
// che manda il client gia' installato sui telefoni.
//
// I test scrivono davvero sul database. Camere, slot e IP sono casuali a ogni
// giro apposta: quota settimanale, vincolo di unicita' sugli slot e rate limit
// sono reali, e con valori fissi il secondo giro fallirebbe. Correttamente.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const imp = (p) => import(new URL("../" + p, import.meta.url).href);
const laundry = (await imp("api/laundry.js")).default;
const rooms = (await imp("api/rooms.js")).default;
const cron = (await imp("api/cron.js")).default;
const telegram = (await imp("api/telegram.js")).default;
const adminAuth = (await imp("api/admin/auth.js")).default;
const adminData = (await imp("api/admin/data.js")).default;

// ─── Harness ─────────────────────────────────────────────────────────────────

const IP = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
const SLOT = 1 + Math.floor(Math.random() * 17);
const ROOM = String(200 + Math.floor(Math.random() * 700));
const TOKEN = process.env.APP_TOKEN;

function mkRes() {
  const r = { _status: 200, _body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (s) => { r._status = s; return r; };
  r.json = (b) => { r._body = b; return r; };
  return r;
}

async function call(fn, { method = "POST", query = {}, body = null, cookie = null, headers = {} } = {}) {
  const h = { "x-forwarded-for": IP, ...headers };
  if (cookie) h.cookie = cookie;
  const req = { method, query, body: body == null ? undefined : JSON.stringify(body), headers: h, socket: {} };
  const res = mkRes();
  await fn(req, res);
  return { status: res._status, body: res._body, headers: res.headers };
}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; failures.push(name); console.log(`  FALLA ${name}  ${detail}`); }
}
const section = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);

// ─── Lavanderia ──────────────────────────────────────────────────────────────

section("Snapshot");
{
  const r = await call(laundry, { method: "GET", query: { token: TOKEN, room: "112" } });
  check("HTTP 200", r.status === 200, `ricevuto ${r.status}`);
  check("slots = 19", r.body?.slots === 19);
  check("week ha 7 giorni", Object.keys(r.body?.week || {}).length === 7);
  check("status ha 6 macchine", Object.keys(r.body?.status || {}).length === 6);
  check("risposta non cacheabile", r.headers["Cache-Control"] === "no-store");

  const s = await call(laundry, { method: "GET", query: { token: TOKEN, room: "42" } });
  check("sezione: solo W-A operativa", s.body.status["W-A"] === "ok" && s.body.status["W-B"] === "oos");

  const n = await call(laundry, { method: "GET", query: { token: TOKEN } });
  check("senza camera ricade sulla principale", n.body?.ok === true);
}

section("Token");
{
  check("GET con token errato -> 401",
    (await call(laundry, { method: "GET", query: { token: "no", room: "112" } })).status === 401);
  check("POST con token errato -> 401",
    (await call(laundry, { body: { token: "no", action: "book" } })).status === 401);
}

section("Prenotazioni");
{
  const b1 = await call(laundry, { body: { token: TOKEN, action: "book", day: 1, slot: SLOT, machine: "W-A", room: ROOM } });
  check("prenota", b1.body?.ok === true, JSON.stringify(b1.body).slice(0, 120));
  check("torna la settimana aggiornata", b1.body?.week?.["1"]?.[String(SLOT)]?.["W-A"] === ROOM);

  const b2 = await call(laundry, { body: { token: TOKEN, action: "book", day: 1, slot: SLOT, machine: "W-A", room: "999" } });
  check("conflitto -> 'occupata'", b2.body?.error === "occupata");
  check("conflitto -> dice chi ha lo slot", b2.body?.by === ROOM);

  // Il client attuale non manda la camera sulla clear: deve funzionare comunque.
  const c = await call(laundry, { body: { token: TOKEN, action: "clear", day: 1, slot: SLOT, machine: "W-A" } });
  check("clear senza camera", c.body?.ok === true);
  check("slot liberato", c.body?.week?.["1"]?.[String(SLOT)] === undefined);
}

section("Fuori servizio riservato agli admin");
{
  const r1 = await call(laundry, { body: { token: TOKEN, action: "status", machine: "W-A", status: "oos" } });
  const r2 = await call(laundry, { body: { token: TOKEN, action: "setStatus", machine: "W-A", oos: true } });
  check("action 'status' -> 403", r1.status === 403);
  check("action 'setStatus' -> 403", r2.status === 403);
  check("il messaggio spiega perche'", /amministratori/.test(r1.body?.error || ""));
}

section("Push e segnalazioni");
{
  const ep = "https://fcm.googleapis.com/fcm/send/TEST-" + Math.random().toString(36).slice(2);
  const s = await call(laundry, { body: { token: TOKEN, action: "subscribe", room: "112", sub: { endpoint: ep, keys: { p256dh: "k", auth: "a" } } } });
  check("subscribe", s.body?.ok === true);
  check("subscribe ripetuta = aggiornamento",
    (await call(laundry, { body: { token: TOKEN, action: "subscribe", room: "113", sub: { endpoint: ep, keys: { p256dh: "k", auth: "a" } } } })).body?.ok === true);
  check("unsubscribe",
    (await call(laundry, { body: { token: TOKEN, action: "unsubscribe", endpoint: ep } })).body?.ok === true);

  check("feedback", (await call(laundry, { body: { token: TOKEN, action: "feedback", room: "112", text: "prova" } })).body?.ok === true);
  check("feedback vuoto respinto", (await call(laundry, { body: { token: TOKEN, action: "feedback", room: "112", text: "  " } })).body?.ok === false);
  check("azione sconosciuta", (await call(laundry, { body: { token: TOKEN, action: "pippo" } })).body?.error === "azione sconosciuta");
  check("metodo non ammesso -> 405", (await call(laundry, { method: "DELETE", query: { token: TOKEN } })).status === 405);
}

// ─── Sale ────────────────────────────────────────────────────────────────────

section("Sale cinema e musica");
{
  const g = await call(rooms, { method: "GET", query: { token: TOKEN, space: "cinema" } });
  check("lettura", g.body?.ok === true && Array.isArray(g.body.bookings));
  check("sala inesistente", (await call(rooms, { method: "GET", query: { token: TOKEN, space: "piscina" } })).body?.error === "sala non valida");

  const start = 600 + SLOT * 20;
  const b1 = await call(rooms, { query: { token: TOKEN, space: "cinema", action: "book" }, body: { day: 4, start, end: start + 60, name: "Test", type: "open" } });
  check("prenota", b1.body?.ok === true, JSON.stringify(b1.body).slice(0, 120));

  const b2 = await call(rooms, { query: { token: TOKEN, space: "cinema", action: "book" }, body: { day: 4, start: start + 30, end: start + 90, name: "Altro", type: "open" } });
  check("sovrapposizione respinta", b2.body?.error === "overlap");

  const b3 = await call(rooms, { query: { token: TOKEN, space: "cinema", action: "book" }, body: { day: 4, start: start + 60, end: start + 120, name: "Adiacente", type: "open" } });
  check("turno adiacente ammesso", b3.body?.ok === true, JSON.stringify(b3.body).slice(0, 120));

  const mine = (b3.body.bookings || []).find((x) => x.name === "Test");
  check("id stringa, orari numerici", typeof mine?.id === "string" && typeof mine?.start === "number");
  check("cancellazione",
    (await call(rooms, { query: { token: TOKEN, space: "cinema", action: "clear" }, body: { id: mine.id } })).body?.ok === true);
}

// ─── Cron ────────────────────────────────────────────────────────────────────

section("Scheduler promemoria");
{
  check("senza segreto -> 401", (await call(cron, {})).status === 401);
  check("segreto errato -> 401", (await call(cron, { headers: { "x-cron-secret": "no" } })).status === 401);

  const ok = await call(cron, { headers: { "x-cron-secret": process.env.CRON_SECRET } });
  check("tick ok", ok.status === 200 && ok.body?.ok === true, JSON.stringify(ok.body));
  const again = await call(cron, { headers: { "x-cron-secret": process.env.CRON_SECRET } });
  check("un secondo tick non rispedisce", again.body?.inviati === 0, `inviati=${again.body?.inviati}`);
}

// ─── Admin ───────────────────────────────────────────────────────────────────

section("Accesso admin");
let cookie = null;
{
  check("stato iniziale non loggato", (await call(adminAuth, { method: "GET" })).body?.logged === false);

  const bad = await call(adminAuth, { body: { action: "login", username: process.env.ADMIN_USER, password: "sbagliata" } });
  check("password errata -> 401", bad.status === 401);
  check("nessun cookie emesso", !bad.headers["Set-Cookie"]);

  const badUser = await call(adminAuth, { body: { action: "login", username: "root", password: "qualsiasi" } });
  check("stesso errore con utente inesistente", badUser.body?.error === bad.body?.error);

  const pw = process.env.ADMIN_TEST_PASSWORD;
  if (!pw) {
    console.log("  salto  login corretto (serve ADMIN_TEST_PASSWORD nell'ambiente)");
  } else {
    const ok = await call(adminAuth, { body: { action: "login", username: process.env.ADMIN_USER, password: pw } });
    check("login corretto", ok.status === 200, JSON.stringify(ok.body));
    const raw = ok.headers["Set-Cookie"];
    const s = Array.isArray(raw) ? raw.join("; ") : String(raw || "");
    check("cookie HttpOnly + Secure + SameSite=Strict",
      /HttpOnly/.test(s) && /Secure/.test(s) && /SameSite=Strict/.test(s));
    cookie = s.split(";")[0];
  }
}

section("Operazioni admin");
{
  check("senza cookie -> 401", (await call(adminData, { body: { action: "overview" } })).status === 401);
  check("cookie contraffatto -> 401", (await call(adminData, { body: { action: "overview" }, cookie: "adm=finto.firma" })).status === 401);

  if (!cookie) {
    console.log("  salto  il resto (nessuna sessione)");
  } else {
    const ov = await call(adminData, { body: { action: "overview" }, cookie });
    check("panoramica", ov.body?.laundries?.length === 2);
    check("griglia settimana", (await call(adminData, { body: { action: "week", laundry_id: 1, offset: 0 }, cookie })).body?.ok === true);

    const s1 = await call(adminData, { body: { action: "setMachineStatus", room: "100", machine: "W-C", oos: true }, cookie });
    check("mette fuori servizio", s1.body?.status?.["W-C"] === "oos");

    // Il punto della modifica richiesta: guasta ma ancora prenotabile.
    const b = await call(laundry, { body: { token: TOKEN, action: "book", day: 5, slot: SLOT, machine: "W-C", room: ROOM } });
    check("una macchina guasta resta prenotabile", b.body?.ok === true, JSON.stringify(b.body).slice(0, 120));
    check("con avviso warning='oos'", b.body?.warning === "oos");

    check("rimette in servizio",
      (await call(adminData, { body: { action: "setMachineStatus", room: "100", machine: "W-C", oos: false }, cookie })).body?.status?.["W-C"] === "ok");

    check("lista segnalazioni", (await call(adminData, { body: { action: "feedback" }, cookie })).body?.ok === true);
    check("lista sale", (await call(adminData, { body: { action: "spaces" }, cookie })).body?.ok === true);
    check("azione sconosciuta", (await call(adminData, { body: { action: "pippo" }, cookie })).body?.error === "azione sconosciuta");
  }
}

// ─── Telegram ────────────────────────────────────────────────────────────────

section("Telegram");
{
  const gen = await call(laundry, { body: { token: TOKEN, action: "telegramCode", room: "318" } });
  const code = gen.body?.code;
  check("codice generato", /^[A-Z0-9]{8}$/.test(code || ""), JSON.stringify(gen.body));
  check("senza vocali", !/[AEIOU]/.test(code || ""), code);

  const chat = "9" + Math.floor(Math.random() * 1e8);
  const tgSend = (text, headers = {}) =>
    call(telegram, { body: { message: { chat: { id: chat }, text } }, headers });

  check("/start senza codice", (await tgSend("/start")).status === 200);
  check("/start con codice", (await tgSend("/start " + code)).status === 200);
  check("/stop", (await tgSend("/stop")).status === 200);

  process.env.TELEGRAM_WEBHOOK_SECRET = "prova";
  check("webhook senza segreto -> 401", (await tgSend("/start")).status === 401);
  check("webhook con segreto -> 200",
    (await tgSend("/start", { "x-telegram-bot-api-secret-token": "prova" })).status === 200);
  delete process.env.TELEGRAM_WEBHOOK_SECRET;

  check("camera non valida respinta",
    (await call(laundry, { body: { token: TOKEN, action: "telegramCode", room: "xyz" } })).body?.ok === false);
}

// ─── Esito ───────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
