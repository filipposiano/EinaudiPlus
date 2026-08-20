// Verifica end-to-end del backend, contro il database vero.
//
//   npm test
//
// Gira gli handler serverless in-process, senza bisogno di `vercel dev`:
// simula gli oggetti req/res come li passa Vercel, incluso il corpo text/plain
// che manda il client gia' installato sui telefoni.
//
// I test scrivono davvero sul database. Camere, slot e IP sono casuali a ogni
// giro apposta: il vincolo di unicita' sugli slot e il rate limit sono reali,
// e con valori fissi il secondo giro fallirebbe. Correttamente.
// (La quota settimanale non e' piu' applicata lato server: era aggirabile
// comunque, l'app non ha login, e bloccava anche chi prenotava per un
// coinquilino o due turni nello stesso giorno.)

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
  // Si assertisce solo su cio' che e' configurazione. Che W-A e D-A siano
  // "ok" NON e' verificabile: un amministratore puo' legittimamente segnarle
  // guaste in qualsiasi momento, e il test fallirebbe senza che nulla sia rotto.
  // Le altre quattro invece non esistono fisicamente, e set_machine_status
  // rifiuta di toccarle (filtra su bookable = true).
  check("Manica: le macchine inesistenti restano oos",
    ["W-B", "W-C", "D-B", "D-C"].every((c) => s.body.status[c] === "oos"),
    JSON.stringify(s.body.status));
  check("Manica: W-A e D-A esistono nello snapshot",
    "W-A" in s.body.status && "D-A" in s.body.status);

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

  // Giorno e fascia dedicati a questo giro: l'exclude constraint e' reale, e
  // due esecuzioni sulla stessa fascia si darebbero fastidio a vicenda.
  const day = Math.floor(Math.random() * 7);
  const start = 60 + Math.floor(Math.random() * 20) * 60;
  const tag = "TEST-" + Math.random().toString(36).slice(2, 7);

  const b1 = await call(rooms, { query: { token: TOKEN, space: "cinema", action: "book" }, body: { day, start, end: start + 60, name: tag, type: "open" } });
  check("prenota", b1.body?.ok === true, JSON.stringify(b1.body).slice(0, 120));

  const b2 = await call(rooms, { query: { token: TOKEN, space: "cinema", action: "book" }, body: { day, start: start + 30, end: start + 90, name: tag + "-x", type: "open" } });
  check("sovrapposizione respinta", b2.body?.error === "overlap");

  const b3 = await call(rooms, { query: { token: TOKEN, space: "cinema", action: "book" }, body: { day, start: start + 60, end: start + 120, name: tag + "-adj", type: "open" } });
  check("turno adiacente ammesso", b3.body?.ok === true, JSON.stringify(b3.body).slice(0, 120));

  const mine = (b3.body?.bookings || []).find((x) => x.name === tag);
  check("id stringa, orari numerici", typeof mine?.id === "string" && typeof mine?.start === "number");

  // Il test si ripulisce dietro: senza, ogni giro lascia righe che il giro
  // dopo trova come sovrapposizioni.
  let removed = 0;
  for (const b of b3.body?.bookings || []) {
    if (!b.name.startsWith(tag)) continue;
    const r = await call(rooms, { query: { token: TOKEN, space: "cinema", action: "clear" }, body: { id: b.id } });
    if (r.body?.ok) removed++;
  }
  check("cancellazione e pulizia", removed === 2, `rimosse ${removed} su 2`);
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

// ─── Sistemista ──────────────────────────────────────────────────────────────

section("Separazione dei ruoli");
{
  // Il controllo che conta: la portineria non deve poter toccare le funzioni
  // del sistemista, indipendentemente da cosa mostra il pannello.
  if (!cookie) {
    console.log("  salto  (nessuna sessione di portineria)");
  } else {
    for (const action of ["recurringList", "purge", "applyRecurring"]) {
      const r = await call(adminData, { body: { action, scope: "settimana" }, cookie });
      check(`portineria non puo' '${action}' -> 403`, r.status === 403, `ricevuto ${r.status}`);
    }
  }
}

section("Sistemista");
let sysCookie = null;
{
  const pw = process.env.SYSADMIN_TEST_PASSWORD;
  if (!pw) {
    console.log("  salto  (serve SYSADMIN_TEST_PASSWORD nell'ambiente)");
  } else {
    const login = await call(adminAuth, { body: { action: "login", username: process.env.SYSADMIN_USER, password: pw } });
    check("login sistemista", login.status === 200 && login.body?.role === "sistemista", JSON.stringify(login.body));
    const raw = login.headers["Set-Cookie"];
    sysCookie = (Array.isArray(raw) ? raw.join("; ") : String(raw || "")).split(";")[0];

    check("puo' leggere le regole",
      (await call(adminData, { body: { action: "recurringList" }, cookie: sysCookie })).body?.ok === true);

    // Regola lavanderia: ogni mercoledì, slot fisso, camera fissa.
    const add = await call(adminData, {
      body: { action: "recurringAddLaundry", laundry_id: 1, day: 2, slot: SLOT, machine: "W-B", room: ROOM },
      cookie: sysCookie,
    });
    check("crea una regola ricorrente", add.body?.ok === true, JSON.stringify(add.body));

    const dup = await call(adminData, {
      body: { action: "recurringAddLaundry", laundry_id: 1, day: 2, slot: SLOT, machine: "W-B", room: "999" },
      cookie: sysCookie,
    });
    check("due regole sullo stesso turno respinte", dup.body?.ok === false, JSON.stringify(dup.body));

    // La regola dev'essere già diventata una prenotazione vera.
    const snap = await call(laundry, { method: "GET", query: { token: TOKEN, room: ROOM } });
    check("la regola è già una prenotazione in griglia",
      snap.body?.week?.["2"]?.[String(SLOT)]?.["W-B"] === ROOM,
      JSON.stringify(snap.body?.week?.["2"]?.[String(SLOT)]));

    // Idempotenza: riapplicare non deve duplicare né fallire.
    const again = await call(adminData, { body: { action: "applyRecurring", offset: 0 }, cookie: sysCookie });
    check("riapplicare è idempotente", again.body?.ok === true && again.body?.saltate >= 1,
      JSON.stringify(again.body));

    const list = await call(adminData, { body: { action: "recurringList" }, cookie: sysCookie });
    const mine = (list.body?.items || []).find((x) => x.room === ROOM && x.kind === "laundry");
    check("la regola compare nell'elenco", Boolean(mine));

    if (mine) {
      check("sospensione",
        (await call(adminData, { body: { action: "recurringSetActive", id: mine.id, active: false }, cookie: sysCookie })).body?.ok === true);
      check("eliminazione",
        (await call(adminData, { body: { action: "recurringDelete", id: mine.id }, cookie: sysCookie })).body?.ok === true);
    }

    // Regola sala
    const sp = await call(adminData, {
      body: { action: "recurringAddSpace", space_id: 2, day: 3, start: 900 + SLOT, end: 960 + SLOT, name: "Prova ricorrente" },
      cookie: sysCookie,
    });
    check("regola ricorrente per la sala", sp.body?.ok === true, JSON.stringify(sp.body));

    const spaces = await call(adminData, { body: { action: "spaces" }, cookie: sysCookie });
    check("la regola sala è già prenotata",
      (spaces.body?.items || []).some((x) => x.name === "Prova ricorrente"));

    const spList = await call(adminData, { body: { action: "recurringList" }, cookie: sysCookie });
    const spRule = (spList.body?.items || []).find((x) => x.name === "Prova ricorrente");
    if (spRule) await call(adminData, { body: { action: "recurringDelete", id: spRule.id }, cookie: sysCookie });

    check("ambito di pulizia inventato respinto",
      (await call(adminData, { body: { action: "purge", scope: "qualsiasi" }, cookie: sysCookie })).body?.ok === false);

    // La pulizia deve ESEGUIRE davvero, non solo rispondere.
    //
    // Regressione vera: le DELETE senza WHERE sono rifiutate dall'estensione
    // safeupdate quando passano da PostgREST ("21000: DELETE requires a WHERE
    // clause"). Dal SQL Editor funzionavano, dal pannello no — e l'errore
    // arrivava mascherato, quindi il pulsante "Azzera tutto" sembrava inerte.
    //
    // Si usa l'ambito 'ricorrenti' perche' e' l'unico che si puo' svuotare
    // senza toccare prenotazioni di persone vere.
    const purge = await call(adminData, { body: { action: "purge", scope: "ricorrenti" }, cookie: sysCookie });
    check("la pulizia esegue senza errori del server", purge.body?.ok === true,
      JSON.stringify(purge.body));
    check("la pulizia riporta i conteggi", purge.body?.cancellati !== undefined,
      JSON.stringify(purge.body));
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
  // Se il segreto e' configurato l'header va sempre mandato, altrimenti il
  // webhook rifiuta — che e' esattamente quello che deve fare.
  const auth = process.env.TELEGRAM_WEBHOOK_SECRET
    ? { "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET }
    : {};
  const tgSend = (text, headers = auth) =>
    call(telegram, { body: { message: { chat: { id: chat }, text } }, headers });

  check("/start senza codice", (await tgSend("/start")).status === 200);
  check("/start con codice", (await tgSend("/start " + code)).status === 200);
  check("/stop", (await tgSend("/stop")).status === 200);

  const prev = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = "prova";
  check("webhook senza segreto -> 401", (await tgSend("/start", {})).status === 401);
  check("webhook con segreto sbagliato -> 401",
    (await tgSend("/start", { "x-telegram-bot-api-secret-token": "altro" })).status === 401);
  check("webhook con segreto giusto -> 200",
    (await tgSend("/start", { "x-telegram-bot-api-secret-token": "prova" })).status === 200);
  if (prev) process.env.TELEGRAM_WEBHOOK_SECRET = prev;
  else delete process.env.TELEGRAM_WEBHOOK_SECRET;

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
