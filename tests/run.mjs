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
  // `x-requested-with` come lo manda il client vero: /api/admin/data lo esige
  // (e' la prova che la richiesta non arriva da un modulo su un altro sito).
  // Qui il test fa le veci del client, quindi lo manda anche lui — un test che
  // parla al server in un modo che nessun client usa non prova granche'.
  const h = { "x-forwarded-for": IP, "x-requested-with": "admin", ...headers };
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

  // Validazione degli ingressi. Prima questi due passavano le guardie SQL e
  // finivano contro un vincolo NOT NULL: il client riceveva 500 "errore del
  // server" per un campo scritto male, che e' un invito a insistere.
  const nonNum = await call(laundry, {
    body: { token: TOKEN, action: "book", day: "pippo", slot: "x", machine: "W-A", room: "112" },
  });
  check("giorno/turno non numerici -> errore chiaro, non 500",
    nonNum.status === 200 && nonNum.body?.error === "giorno o turno non valido",
    JSON.stringify(nonNum.body));

  check("turno decimale respinto",
    (await call(laundry, { body: { token: TOKEN, action: "book", day: 1, slot: 2.5, machine: "W-A", room: "112" } }))
      .body?.error === "giorno o turno non valido");

  check("camera malformata respinta",
    (await call(laundry, { body: { token: TOKEN, action: "book", day: 1, slot: 3, machine: "W-A", room: "../etc" } }))
      .body?.error === "camera non valida");

  // Si poteva scrivere in push_sub qualunque stringa, compreso l'indirizzo dei
  // metadati cloud. Non veniva mai contattato (sendWebPush ha la sua
  // allowlist), ma la riga restava in tabella, legata a una camera vera, e la
  // potatura non l'avrebbe mai tolta.
  check("endpoint push arbitrario respinto",
    (await call(laundry, {
      body: {
        token: TOKEN, action: "subscribe", room: "112",
        sub: { endpoint: "http://169.254.169.254/latest/meta-data", keys: { p256dh: "a", auth: "b" } },
      },
    })).body?.error === "endpoint di notifica non riconosciuto");
}

// ─── Sale ────────────────────────────────────────────────────────────────────

section("Sale cinema e musica");
{
  const g = await call(rooms, { method: "GET", query: { token: TOKEN, space: "cinema" } });
  check("lettura", g.body?.ok === true && Array.isArray(g.body.bookings));
  check("sala inesistente", (await call(rooms, { method: "GET", query: { token: TOKEN, space: "piscina" } })).body?.error === "sala non valida");

  // Una finestra di tre ore DAVVERO libera, cercata nella griglia.
  //
  // Prima si pescava giorno e ora a caso. L'exclude constraint e' reale e il
  // database e' quello di produzione: appena il cinema si riempie — e si
  // riempie — il turno pescato cadeva su una prenotazione vera e mezza sezione
  // falliva, come se fosse una regressione. Servono tre ore consecutive:
  // il test prenota, verifica la sovrapposizione e poi occupa anche l'ora
  // adiacente.
  const occupate = (g.body?.bookings || []);
  const libero = (d, s) => !occupate.some((b) => b.day === d && s < b.end && b.start < s + 180);

  let day = 0, start = 60;
  cerca: for (let d = 0; d < 7; d++) {
    for (let s = 60; s <= 20 * 60; s += 60) {
      if (libero(d, s)) { day = d; start = s; break cerca; }
    }
  }

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

  // ── Oltre la mezzanotte, sala musica ──────────────────────────────────────
  //
  // La musica e' passata da "chiude alle 23" a scavalcabile come il cinema.
  // Il pezzo dopo la mezzanotte non e' una nota sulla stessa riga: sono due
  // righe su due giorni consecutivi, legate da group_id, ed e' quel legame a
  // far sparire entrambe quando se ne cancella una. Senza, resterebbe mezza
  // prenotazione fantasma sul giorno dopo.
  const gm = await call(rooms, { method: "GET", query: { token: TOKEN, space: "music" } });
  const musOccupate = gm.body?.bookings || [];
  // Serve un giorno la cui sera E la notte seguente siano libere.
  const seraLibera = (d) => !musOccupate.some((b) => b.day === d && b.end > 22 * 60)
                         && !musOccupate.some((b) => b.day === (d + 1) % 7 && b.start < 90);
  let notte = -1;
  for (let d = 0; d < 7; d++) if (seraLibera(d)) { notte = d; break; }

  if (notte < 0) {
    console.log("  salto  (nessuna notte libera in sala musica questa settimana)");
  } else {
    const tagN = "TESTN-" + Math.random().toString(36).slice(2, 7);
    // 23:00 -> 01:00: l'ora d'inizio e' l'ultima che la griglia offre.
    const bn = await call(rooms, {
      query: { token: TOKEN, space: "music", action: "book" },
      body: { day: notte, start: 23 * 60, end: 25 * 60, name: tagN },
    });
    check("la musica si prenota oltre la mezzanotte", bn.body?.ok === true, JSON.stringify(bn.body).slice(0, 120));

    const meta = (bn.body?.bookings || []).filter((x) => x.name === tagN);
    check("diventa due righe su due giorni", meta.length === 2, `righe: ${meta.length}`);
    check("il pezzo dopo mezzanotte sta sul giorno dopo",
      meta.some((x) => x.day === notte && x.end === 1440) &&
      meta.some((x) => x.day === (notte + 1) % 7 && x.start === 0),
      JSON.stringify(meta.map((x) => [x.day, x.start, x.end])));
    check("le due meta' condividono il gruppo",
      meta.length === 2 && meta[0].group && meta[0].group === meta[1].group);

    // Cancellandone UNA sola devono sparire entrambe.
    if (meta.length) {
      const via = await call(rooms, { query: { token: TOKEN, space: "music", action: "clear" }, body: { id: meta[0].id } });
      const resta = (via.body?.bookings || []).filter((x) => x.name === tagN).length;
      check("cancellarne una toglie tutta la serata", resta === 0, `rimaste ${resta}`);
    }
  }

  // ── La notte fra domenica e lunedi' ───────────────────────────────────────
  //
  // Il caso che il giro qui sopra non prova mai: sceglie la PRIMA notte libera
  // della settimana, che in pratica e' sempre il lunedi'. La domenica e'
  // l'unico giorno in cui il "giorno dopo" non sta nella stessa settimana, ed
  // e' esattamente li' che stava il difetto (vedi migrations/018): la coda
  // finiva sul lunedi' di QUELLA settimana, cioe' sei giorni prima.
  //
  // Da fuori non si vede il week_start, quindi la prova e' indiretta ma
  // decisiva: la coda NON deve comparire fra le prenotazioni della settimana
  // corrente. Se ricompare come lunedi' 00:00, e' tornata indietro nel tempo.
  const gd = await call(rooms, { method: "GET", query: { token: TOKEN, space: "music" } });
  const occDom = gd.body?.bookings || [];
  const domLibera = !occDom.some((b) => b.day === 6 && b.end > 22 * 60);

  if (!domLibera) {
    console.log("  salto  (domenica sera gia' occupata in sala musica)");
  } else {
    const tagD = "TESTD-" + Math.random().toString(36).slice(2, 7);
    const bd = await call(rooms, {
      query: { token: TOKEN, space: "music", action: "book" },
      body: { day: 6, start: 21 * 60, end: 26 * 60, name: tagD },   // dom 21:00 -> lun 02:00
    });
    check("domenica notte si prenota", bd.body?.ok === true, JSON.stringify(bd.body).slice(0, 120));

    const suoi = (bd.body?.bookings || []).filter((x) => x.name === tagD);
    check("di domenica resta la sola testa nella settimana corrente",
      suoi.length === 1 && suoi[0].day === 6 && suoi[0].start === 21 * 60 && suoi[0].end === 1440,
      JSON.stringify(suoi.map((x) => [x.day, x.start, x.end])));
    check("la coda non torna indietro sul lunedi' appena passato",
      !suoi.some((x) => x.day === 0),
      JSON.stringify(suoi.map((x) => [x.day, x.start, x.end])));

    // Cancellando la testa deve sparire anche la coda, che sta in un'altra
    // settimana: se delete_space_booking filtrasse per week_start resterebbe
    // li' per sempre, invisibile e capace di far fallire la prossima domenica.
    if (suoi.length) {
      await call(rooms, { query: { token: TOKEN, space: "music", action: "clear" }, body: { id: suoi[0].id } });
      const ri = await call(rooms, {
        query: { token: TOKEN, space: "music", action: "book" },
        body: { day: 6, start: 21 * 60, end: 26 * 60, name: tagD + "-2" },
      });
      check("dopo la cancellazione la stessa notte torna libera", ri.body?.ok === true,
        JSON.stringify(ri.body).slice(0, 120));
      const suoi2 = (ri.body?.bookings || []).filter((x) => x.name === tagD + "-2");
      if (suoi2.length) {
        await call(rooms, { query: { token: TOKEN, space: "music", action: "clear" }, body: { id: suoi2[0].id } });
      }
    }
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// Gli account non stanno piu' nelle variabili d'ambiente di Vercel (migrazione
// 008): vivono nella tabella admin_account. Ai test serve percio' UNA sola
// credenziale vera, quella di un sistemista, dichiarata in .env.local:
//
//   TEST_ADMIN_USER / TEST_ADMIN_PASSWORD
//
// L'account di livello FDO che serve alle prove sui permessi se lo creano da
// soli qui sotto, e lo cancellano alla fine. Cosi' non c'e' una seconda
// password da tenere in giro, e non restano account di prova nell'elenco di
// chi amministra davvero.
const SYS_USER = process.env.TEST_ADMIN_USER;
const SYS_PASS = process.env.TEST_ADMIN_PASSWORD;

/** Fa il login e torna il cookie di sessione, o null. */
async function accedi(username, password) {
  const r = await call(adminAuth, { body: { action: "login", username, password } });
  if (r.status !== 200) return null;
  const raw = r.headers["Set-Cookie"];
  return (Array.isArray(raw) ? raw.join("; ") : String(raw || "")).split(";")[0];
}

section("Accesso admin");
let cookie = null;        // sessione di livello FDO (account usa-e-getta)
let sysCookie = null;     // sessione sistemista
let fdoUsaEGetta = null;  // { id, username, password }
{
  check("stato iniziale non loggato", (await call(adminAuth, { method: "GET" })).body?.logged === false);

  const bad = await call(adminAuth, { body: { action: "login", username: SYS_USER, password: "sbagliata" } });
  check("password errata -> 401", bad.status === 401);
  check("nessun cookie emesso", !bad.headers["Set-Cookie"]);

  const badUser = await call(adminAuth, { body: { action: "login", username: "root", password: "qualsiasi" } });
  check("stesso errore con utente inesistente", badUser.body?.error === bad.body?.error);

  if (!SYS_USER || !SYS_PASS) {
    console.log("  salto  (servono TEST_ADMIN_USER e TEST_ADMIN_PASSWORD nell'ambiente)");
  } else {
    const ok = await call(adminAuth, { body: { action: "login", username: SYS_USER, password: SYS_PASS } });
    check("login corretto", ok.status === 200, JSON.stringify(ok.body));
    const raw = ok.headers["Set-Cookie"];
    const s = Array.isArray(raw) ? raw.join("; ") : String(raw || "");
    check("cookie HttpOnly + Secure + SameSite=Strict",
      /HttpOnly/.test(s) && /Secure/.test(s) && /SameSite=Strict/.test(s));
    sysCookie = s.split(";")[0];

    // L'account FDO temporaneo. Nome con marcatore e numero casuale: se un
    // giro di test si interrompe a meta' si riconosce a colpo d'occhio quale
    // riga e' un residuo da togliere.
    const nome = "zz-test-" + Math.random().toString(36).slice(2, 8);
    const pw = "Prova-" + Math.random().toString(36).slice(2, 12);
    const creato = await call(adminData, {
      body: { action: "accountCreate", username: nome, password: pw, ruolo: "fdo" },
      cookie: sysCookie,
    });
    check("il sistemista crea un account fdo", creato.body?.ok === true, JSON.stringify(creato.body));
    if (creato.body?.ok) {
      fdoUsaEGetta = { id: creato.body.id, username: nome, password: pw };
      cookie = await accedi(nome, pw);
      check("l'account appena creato riesce ad accedere", Boolean(cookie));

      // La password provvisoria apre la sessione ma non fa fare niente.
      //
      // Il pannello mostra gia' una sala d'attesa al posto di qualunque
      // scheda, ma quella e' una cortesia verso chi il pannello lo usa: chi
      // parla all'API direttamente la scavalca. Verificato una volta che si
      // poteva davvero (azione riuscita, 200), ora il server rifiuta — e
      // questa prova serve ad accorgersene se un domani tornasse a essere
      // solo una schermata.
      const conProvvisoria = await call(adminData, {
        body: { action: "week", laundry_id: 1, offset: 0 },
        cookie,
      });
      check("con la password provvisoria le azioni sono respinte",
        conProvvisoria.status === 403, `ricevuto ${conProvvisoria.status}`);

      const pwScelta = "Scelta-" + Math.random().toString(36).slice(2, 12);
      const cambio = await call(adminData, {
        body: {
          action: "accountChangeOwnPassword",
          password_attuale: pw, password_nuova: pwScelta,
        },
        cookie,
      });
      check("ma cambiare la password si puo' (e' l'unica azione ammessa)",
        cambio.body?.ok === true, JSON.stringify(cambio.body));

      if (cambio.body?.ok) {
        fdoUsaEGetta.password = pwScelta;
        const dopo = await call(adminData, {
          body: { action: "week", laundry_id: 1, offset: 0 },
          cookie,
        });
        check("e da li' in poi lavora normalmente",
          dopo.body?.ok === true, JSON.stringify(dopo.body).slice(0, 120));
      }
    }
  }
}

section("Operazioni admin");
{
  check("senza cookie -> 401", (await call(adminData, { body: { action: "overview" } })).status === 401);

  // Un modulo HTML da un altro sito puo' fare POST portandosi dietro i cookie,
  // ma non puo' impostare un header inventato. Prima questo header il client lo
  // mandava e il server non lo guardava: sembrava una protezione e non lo era.
  check("senza x-requested-with -> respinta (CSRF)",
    (await call(adminData, { body: { action: "overview" }, headers: { "x-requested-with": "" } })).status === 400);
  check("cookie contraffatto -> 401", (await call(adminData, { body: { action: "overview" }, cookie: "adm=finto.firma" })).status === 401);

  if (!cookie) {
    console.log("  salto  il resto (nessuna sessione)");
  } else {
    const ov = await call(adminData, { body: { action: "overview" }, cookie });
    check("panoramica", ov.body?.laundries?.length === 2);
    check("griglia settimana", (await call(adminData, { body: { action: "week", laundry_id: 1, offset: 0 }, cookie })).body?.ok === true);

    const s1 = await call(adminData, { body: { action: "setMachineStatus", room: "100", machine: "W-C", oos: true }, cookie });
    check("mette fuori servizio", s1.body?.status?.["W-C"] === "oos");

    // Uno slot LIBERO davvero, letto dalla griglia, invece di uno a caso.
    //
    // Questi test girano contro il database di produzione (.env.local punta
    // li', un database di staging non esiste). Con la settimana piena di
    // prenotazioni vere, pescare `day: 5, slot: random` finiva regolarmente
    // addosso a qualcuno — il test falliva con {"error":"occupata","by":"273"}
    // e sembrava una regressione del codice mentre era solo sfortuna.
    const griglia = (await call(laundry, { method: "GET", query: { token: TOKEN, room: ROOM } })).body?.week || {};
    let libero = null;
    for (let d = 6; d >= 0 && !libero; d--) {
      for (let sl = 18; sl >= 0; sl--) {
        if (!griglia?.[d]?.[sl]?.["W-C"]) { libero = { day: d, slot: sl }; break; }
      }
    }
    if (!libero) libero = { day: 5, slot: SLOT };   // settimana piena: si tenta comunque

    const b = await call(laundry, { body: { token: TOKEN, action: "book", day: libero.day, slot: libero.slot, machine: "W-C", room: ROOM } });
    check("una macchina guasta resta prenotabile", b.body?.ok === true, JSON.stringify(b.body).slice(0, 120));
    check("con avviso warning='oos'", b.body?.warning === "oos");

    // La prenotazione di prova si toglie: restava in griglia, e a ogni giro
    // il test ne lasciava un'altra finche' la settimana non si riempiva di
    // camere inventate — che poi e' come si era arrivati alle collisioni.
    if (b.body?.ok) {
      await call(laundry, { body: { token: TOKEN, action: "clear", day: libero.day, slot: libero.slot, machine: "W-C", room: ROOM } });
    }

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
  // Il controllo che conta: l'FDO non deve poter toccare le funzioni
  // del sistemista, indipendentemente da cosa mostra il pannello.
  if (!cookie) {
    console.log("  salto  (nessuna sessione FDO)");
  } else {
    for (const action of ["recurringList", "purge", "applyRecurring", "counts"]) {
      const r = await call(adminData, { body: { action, scope: "settimana" }, cookie });
      check(`FDO non puo' '${action}' -> 403`, r.status === 403, `ricevuto ${r.status}`);
    }
  }
}

section("Sistemista");
{
  if (!sysCookie) {
    console.log("  salto  (serve una sessione sistemista: vedi TEST_ADMIN_USER)");
  } else {
    check("login sistemista", true);

    check("puo' leggere le regole",
      (await call(adminData, { body: { action: "recurringList" }, cookie: sysCookie })).body?.ok === true);

    // Regola lavanderia, su un turno mercoledì DAVVERO libero.
    //
    // Con uno slot a caso la regola cadeva su una prenotazione vera, e allora
    // non si materializza (per progetto: una regola non scippa il turno a
    // nessuno). Il test lo leggeva come un fallimento.
    const gr = (await call(laundry, { method: "GET", query: { token: TOKEN, room: ROOM } })).body?.week || {};
    let slotLibero = SLOT;
    for (let sl = 18; sl >= 0; sl--) {
      if (!gr?.[2]?.[sl]?.["W-B"]) { slotLibero = sl; break; }
    }

    const add = await call(adminData, {
      body: { action: "recurringAddLaundry", laundry_id: 1, day: 2, slot: slotLibero, machine: "W-B", room: ROOM },
      cookie: sysCookie,
    });
    check("crea una regola ricorrente", add.body?.ok === true, JSON.stringify(add.body));

    const dup = await call(adminData, {
      body: { action: "recurringAddLaundry", laundry_id: 1, day: 2, slot: slotLibero, machine: "W-B", room: "999" },
      cookie: sysCookie,
    });
    check("due regole sullo stesso turno respinte", dup.body?.ok === false, JSON.stringify(dup.body));

    // Una regola creata adesso NON tocca la settimana in corso: vale dal
    // lunedì successivo, quando gira il job. Niente occupazioni a sorpresa.
    const beforeApply = await call(laundry, { method: "GET", query: { token: TOKEN, room: ROOM } });
    check("la regola non è ancora una prenotazione",
      beforeApply.body?.week?.["2"]?.[String(slotLibero)]?.["W-B"] !== ROOM,
      JSON.stringify(beforeApply.body?.week?.["2"]?.[String(slotLibero)]));

    // "Applica ora" è l'unico modo di materializzarla prima del lunedì —
    // qui serve per poterla verificare senza aspettare una settimana.
    const applied = await call(adminData, { body: { action: "applyRecurring", offset: 0 }, cookie: sysCookie });
    check("applica ora riesce", applied.body?.ok === true, JSON.stringify(applied.body));

    const snap = await call(laundry, { method: "GET", query: { token: TOKEN, room: ROOM } });
    check("dopo applica ora la regola è una prenotazione in griglia",
      snap.body?.week?.["2"]?.[String(slotLibero)]?.["W-B"] === ROOM,
      JSON.stringify(snap.body?.week?.["2"]?.[String(slotLibero)]));

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

    // Cancellare la regola NON cancella la prenotazione che ha gia' creato: e'
    // il comportamento giusto (documentato in DEPLOY.md), ma in un test vuol
    // dire lasciare una riga a ogni giro. Ne erano rimaste sedici, una per
    // slot, che avevano riempito tutto il mercoledi' di W-B e facevano
    // fallire proprio il controllo qui sopra. Si toglie a mano.
    await call(laundry, { body: { token: TOKEN, action: "clear", day: 2, slot: slotLibero, machine: "W-B", room: ROOM } });

    // Regola sala
    const sp = await call(adminData, {
      body: { action: "recurringAddSpace", space_id: 2, day: 3, start: 900 + SLOT, end: 960 + SLOT, name: "Prova ricorrente" },
      cookie: sysCookie,
    });
    check("regola ricorrente per la sala", sp.body?.ok === true, JSON.stringify(sp.body));

    const spacesBefore = await call(adminData, { body: { action: "spaces" }, cookie: sysCookie });
    check("la regola sala non è ancora prenotata",
      !(spacesBefore.body?.items || []).some((x) => x.name === "Prova ricorrente"));

    await call(adminData, { body: { action: "applyRecurring", offset: 0 }, cookie: sysCookie });

    const spaces = await call(adminData, { body: { action: "spaces" }, cookie: sysCookie });
    check("dopo applica ora la regola sala è prenotata",
      (spaces.body?.items || []).some((x) => x.name === "Prova ricorrente"));

    const spList = await call(adminData, { body: { action: "recurringList" }, cookie: sysCookie });
    const spRule = (spList.body?.items || []).find((x) => x.name === "Prova ricorrente");
    if (spRule) await call(adminData, { body: { action: "recurringDelete", id: spRule.id }, cookie: sysCookie });

    check("ambito di pulizia inventato respinto",
      (await call(adminData, { body: { action: "purge", scope: "qualsiasi" }, cookie: sysCookie })).body?.ok === false);

    // La pulizia per singola sala: qui si controllano solo i rifiuti, che non
    // cancellano niente. Le quattro sale valide restano sotto TEST_ALLOW_PURGE.
    check("sala inventata respinta",
      (await call(adminData, { body: { action: "purge", scope: "settimana", sala: "piscina" }, cookie: sysCookie })).body?.ok === false);

    check("la sala non vale per le segnalazioni",
      (await call(adminData, { body: { action: "purge", scope: "segnalazioni", sala: "cinema" }, cookie: sysCookie })).body?.ok === false);

    // Il contatore. Deve rispondere per tutte e quattro le sale: la
    // polivalente e' quella che la pulizia non vedeva, e un contatore che la
    // dimentica ripeterebbe lo stesso silenzio.
    const conteggi = await call(adminData, { body: { action: "counts" }, cookie: sysCookie });
    check("il contatore risponde", conteggi.body?.ok === true, JSON.stringify(conteggi.body));
    for (const sala of ["lavanderia", "cinema", "musica", "polivalente"]) {
      check(`il contatore conosce '${sala}'`,
        typeof conteggi.body?.totale?.[sala] === "number" &&
        typeof conteggi.body?.settimana?.[sala] === "number",
        JSON.stringify(conteggi.body));
    }

    // La pulizia deve ESEGUIRE davvero, non solo rispondere.
    //
    // Regressione vera: le DELETE senza WHERE sono rifiutate dall'estensione
    // safeupdate quando passano da PostgREST ("21000: DELETE requires a WHERE
    // clause"). Dal SQL Editor funzionavano, dal pannello no — e l'errore
    // arrivava mascherato, quindi il pulsante "Azzera tutto" sembrava inerte.
    //
    // DISTRUTTIVO, e va chiesto esplicitamente.
    //
    // Il commento qui diceva che 'ricorrenti' era "l'unico ambito che si puo'
    // svuotare senza toccare niente di vero". Non e' cosi': cancella
    // `recurring_booking` PER INTERO, cioe' tutte le regole fisse che il
    // sistemista ha configurato ("ogni lunedi' alle 09:30 la lavatrice B e'
    // della 101"). Era vero solo finche' la tabella era vuota, ed e' rimasto
    // scritto dopo. Siccome questi test girano contro il database di
    // PRODUZIONE — .env.local punta li' e un database di staging non esiste —
    // ogni `npm test` cancellava in silenzio la configurazione vera.
    if (process.env.TEST_ALLOW_PURGE === "1") {
      const purge = await call(adminData, { body: { action: "purge", scope: "ricorrenti" }, cookie: sysCookie });
      check("la pulizia esegue senza errori del server", purge.body?.ok === true,
        JSON.stringify(purge.body));
      check("la pulizia riporta i conteggi", purge.body?.cancellati !== undefined,
        JSON.stringify(purge.body));
    } else {
      console.log("  --    pulizia distruttiva saltata (TEST_ALLOW_PURGE=1 per eseguirla)");
    }
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

  // Il caso che nessun test copriva, ed e' quello che si era rotto: senza la
  // variabile d'ambiente il controllo spariva del tutto e il webhook accettava
  // chiunque. Un endpoint che si apre quando manca la configurazione e' peggio
  // di uno che non funziona, perche' non lo segnala nulla.
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  check("webhook senza variabile configurata -> 401 (non passa)",
    (await tgSend("/start", {})).status === 401);

  if (prev) process.env.TELEGRAM_WEBHOOK_SECRET = prev;
  else delete process.env.TELEGRAM_WEBHOOK_SECRET;

  check("camera non valida respinta",
    (await call(laundry, { body: { token: TOKEN, action: "telegramCode", room: "xyz" } })).body?.ok === false);
}

// ─── Confine della settimana ─────────────────────────────────────────────────
//
// Il difetto che questa sezione sorveglia: sei dei diciannove slot finiscono
// dopo la mezzanotte (il 13 va 23:15->00:30, il 18 va 05:30->06:45), quindi uno
// slot "di domenica" alle 02:00 accade in realta' lunedi'. Client e server
// datavano quel momento in due settimane diverse, e fra le 00:00 e le 06:59 del
// lunedi' le prenotazioni della domenica notte sparivano dall'app mentre la
// lavatrice girava ancora.
//
// E' una prova locale, senza rete: verifica un invariante fra due file, non il
// comportamento del server. Serve proprio perche' nessun test poteva accorgersi
// del difetto — girando di giorno, i due orologi coincidono sempre.

section("Confine della settimana");
{
  // I due numeri che devono restare uguali, letti dalle rispettive sorgenti
  // invece che riscritti qui: se qualcuno sposta il primo turno da una parte
  // sola, questa prova cade.
  const modello = fs.readFileSync(path.join(ROOT, "modello.ts"), "utf8");
  const schema  = fs.readFileSync(path.join(ROOT, "supabase", "schema.sql"), "utf8");

  const mCli = modello.match(/if \(mins < (\d+) \* (\d+)\)/);
  const mSrv = schema.match(/slot0_min\s+smallint not null default (\d+)/);
  check("nowInfo dichiara ancora lo scarto orario", mCli !== null);
  check("schema.sql dichiara ancora slot0_min", mSrv !== null);

  const scartoClient = mCli ? Number(mCli[1]) * Number(mCli[2]) : NaN;
  const scartoServer = mSrv ? Number(mSrv[1]) : NaN;
  check(
    `client e server iniziano la giornata alla stessa ora (${scartoClient} = ${scartoServer})`,
    scartoClient === scartoServer,
    `client ${scartoClient} min, server ${scartoServer} min`
  );

  // Sweep di una settimana intera: per ogni istante, la settimana che il client
  // intende deve essere quella che il server calcola.
  const N_SLOTS = 19;
  const nowInfo = (d) => {
    let mins = d.getHours() * 60 + d.getMinutes();
    let shift = 0;
    if (mins < scartoClient) { shift = -1; mins += 1440; }
    const since = mins - scartoClient;
    const slot = Math.min(Math.floor(since / 75), N_SLOTS - 1);
    return { base: new Date(d.getFullYear(), d.getMonth(), d.getDate() + shift), slot };
  };
  const lunediDi = (d) => {
    const x = new Date(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // current_laundry_week_start: date_trunc('week', now() - slot0_min).
  const settimanaServer = (d) => lunediDi(new Date(d.getTime() - scartoServer * 60000));
  const settimanaClient = (d) => lunediDi(nowInfo(d).base);

  const disallineati = [];
  const lunedi = new Date(2026, 7, 24); // 24 ago 2026 e' un lunedi'
  for (let g = 0; g < 7; g++)
    for (let h = 0; h < 24; h++)
      for (const m of [0, 30, 59]) {
        const d = new Date(2026, 7, 24 + g, h, m);
        if (iso(settimanaClient(d)) !== iso(settimanaServer(d)))
          disallineati.push(`${d.toDateString()} ${h}:${m}`);
      }
  check(
    "client e server datano ogni istante nella stessa settimana",
    disallineati.length === 0,
    `${disallineati.length} disallineati, primo: ${disallineati[0]}`
  );

  // Il caso concreto, chiamato per nome: la notte fra domenica e lunedi'.
  const notte = new Date(2026, 7, 24, 2, 0);        // lunedi' 24 ago, ore 02:00
  const lunediPrec = new Date(2026, 7, 17);         // il lunedi' della settimana che finisce
  check(
    "alle 02:00 del lunedi' si guarda ancora la settimana che finisce",
    iso(settimanaServer(notte)) === iso(lunediPrec),
    `atteso ${iso(lunediPrec)}, ottenuto ${iso(settimanaServer(notte))}`
  );
  check(
    "alle 07:00 del lunedi' la settimana e' scattata",
    iso(settimanaServer(new Date(2026, 7, 24, 7, 0))) === iso(lunedi),
    `atteso ${iso(lunedi)}, ottenuto ${iso(settimanaServer(new Date(2026, 7, 24, 7, 0)))}`
  );
}

// ─── Iscrizioni push e DIREZIONE ────────────────────────────────
//
// Il difetto sorvegliato: chi amministra entra con 1935 e l'app lo porta su
// DIREZIONE. Se in quel momento refreshSubscription() riallinea l'iscrizione
// del dispositivo, l'upsert sull'endpoint la sposta sotto DIREZIONE: la camera
// vera smette di ricevere i promemoria, e in portineria compare una DIREZIONE
// che nessuno ha attivato — che si ricrea da sola a ogni riapertura, anche
// dopo averla cancellata dal pannello.
//
// Prova locale sulla sorgente: il riallineamento silenzioso e' l'unica strada
// che porta li' senza un gesto dell'utente, e nessun test di rete potrebbe
// accorgersene (il server accetta DIREZIONE apposta, per chi la attiva a mano).

section("Iscrizioni push e DIREZIONE");
{
  const push = fs.readFileSync(path.join(ROOT, "push.ts"), "utf8");
  const corpo = push.slice(push.indexOf("export async function refreshSubscription"));
  check(
    "refreshSubscription() non riaggancia in silenzio la DIREZIONE",
    /if \(room === api\.DIREZIONE\) return;/.test(corpo.slice(0, corpo.indexOf("try {")))
  );
}

// ─── Pulizia ─────────────────────────────────────────────────────────────────
//
// L'account temporaneo va tolto SEMPRE, anche se qualche prova sopra e'
// fallita: un test rosso che lascia dietro un account amministrativo attivo
// e' un problema piu' serio del test stesso.
if (fdoUsaEGetta && sysCookie) {
  const via = await call(adminData, {
    body: { action: "accountDelete", id: fdoUsaEGetta.id },
    cookie: sysCookie,
  });
  check("l'account di prova viene cancellato", via.body?.ok === true, JSON.stringify(via.body));
  const resta = await accedi(fdoUsaEGetta.username, fdoUsaEGetta.password);
  check("e non riesce piu' ad accedere", resta === null);
}

// ─── Esito ───────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
