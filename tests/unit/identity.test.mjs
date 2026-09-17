// Unit test del modulo Identity — SENZA rete, SENZA Supabase, SENZA env var.
//
// Dimostra esattamente ciò che l'audit segnala come mancante oggi (vedi
// ARCHITETTURA-ENTERPRISE.md, punto 8): con lo strato application/ separato
// dall'infrastructure/, ogni use-case si verifica isolatamente con un
// repository finto in memoria, in millisecondi, in CI, senza credenziali.
//
// Stile del runner (check/section) mantenuto identico a tests/run.mjs nella
// root del progetto, per coerenza con la convenzione già in uso.
//
//   node refactor-enterprise/tests/unit/identity.test.mjs

import { authenticate } from "../../src/modules/identity/application/authenticate.js";
import { changeOwnPassword } from "../../src/modules/identity/application/changeOwnPassword.js";
import { createAccount, resetAccountPassword } from "../../src/modules/identity/application/manageAccounts.js";
import { authorize, isSysadmin, isStaff, isDelegato, isValidRole } from "../../src/modules/identity/domain/roles.js";
import { sessioneAncoraValida } from "../../src/modules/identity/domain/sessionState.js";
import { issueToken, readToken } from "../../src/modules/identity/infrastructure/sessionToken.js";
import { hashPassword, verifyPassword } from "../../src/modules/identity/infrastructure/passwordHasher.js";

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; failures.push(name); console.log(`  FALLA ${name}  ${detail}`); }
}
const section = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);

// ─── Repository finto, in memoria ───────────────────────────────────────────
// Nessuna chiamata di rete: authenticate() e gli altri use-case non sanno
// (e non devono sapere) se parlano con questo finto o con Supabase vero.

function fakeRepository(initialAccounts = []) {
  const rows = new Map(initialAccounts.map((a) => [a.username, { ...a }]));
  let nextId = rows.size + 1;
  return {
    async byUsername(username) { return rows.get(username) || null; },
    async create({ username, passwordHash, ruolo }) {
      const row = { id: nextId++, username, password_hash: passwordHash, ruolo, attivo: true };
      rows.set(username, row);
      return { ok: true, id: row.id };
    },
    async setPassword({ id, passwordHash }) {
      for (const row of rows.values()) if (row.id === id) row.password_hash = passwordHash;
      return { ok: true };
    },
    async setOwnPassword({ username, passwordHash }) {
      const row = rows.get(username);
      if (row) row.password_hash = passwordHash;
      return { ok: true };
    },
    _rows: rows,
  };
}

const realHasher = { hashPassword, verifyPassword };

// ─── authenticate() ──────────────────────────────────────────────────────────

section("authenticate()");
{
  const repo = fakeRepository([
    { id: 1, username: "mario", password_hash: hashPassword("Corretta-123"), ruolo: "fdo", attivo: true },
    { id: 2, username: "disattivato", password_hash: hashPassword("Qualsiasi-1"), ruolo: "staff", attivo: false },
  ]);

  const ok = await authenticate({ username: "mario", password: "Corretta-123" }, { accountRepository: repo, hasher: realHasher });
  check("credenziali corrette -> ruolo", ok === "fdo", `ricevuto ${ok}`);

  const wrongPw = await authenticate({ username: "mario", password: "sbagliata" }, { accountRepository: repo, hasher: realHasher });
  check("password sbagliata -> null", wrongPw === null);

  const noUser = await authenticate({ username: "fantasma", password: "qualsiasi" }, { accountRepository: repo, hasher: realHasher });
  check("utente inesistente -> null", noUser === null);

  const disabled = await authenticate({ username: "disattivato", password: "Qualsiasi-1" }, { accountRepository: repo, hasher: realHasher });
  check("account disattivato -> null anche con password giusta", disabled === null);

  // Il repository "muto" (simula Supabase irraggiungibile): niente rete di
  // sicurezza, l'accesso deve essere rifiutato, non concesso per default.
  const brokenRepo = { async byUsername() { throw new Error("database non raggiungibile"); } };
  const dbDown = await authenticate({ username: "mario", password: "Corretta-123" }, { accountRepository: brokenRepo, hasher: realHasher });
  check("database irraggiungibile -> accesso rifiutato, non concesso", dbDown === null);
}

// ─── changeOwnPassword() ─────────────────────────────────────────────────────

section("changeOwnPassword()");
{
  const repo = fakeRepository([{ id: 1, username: "mario", password_hash: hashPassword("Vecchia-123"), ruolo: "fdo", attivo: true }]);

  let errore = null;
  try {
    await changeOwnPassword({ username: "mario", currentPassword: "sbagliata", newPassword: "Nuova-1234" }, { accountRepository: repo, hasher: realHasher });
  } catch (e) { errore = e; }
  check("password attuale sbagliata -> rifiutato", errore?.message === "password attuale non corretta");

  errore = null;
  try {
    await changeOwnPassword({ username: "mario", currentPassword: "Vecchia-123", newPassword: "corta" }, { accountRepository: repo, hasher: realHasher });
  } catch (e) { errore = e; }
  check("nuova password troppo corta -> rifiutata", /almeno 8 caratteri/.test(errore?.message || ""));

  await changeOwnPassword({ username: "mario", currentPassword: "Vecchia-123", newPassword: "Nuova-1234" }, { accountRepository: repo, hasher: realHasher });
  const rilogin = await authenticate({ username: "mario", password: "Nuova-1234" }, { accountRepository: repo, hasher: realHasher });
  check("dopo il cambio, la nuova password funziona davvero", rilogin === "fdo");
  const vecchiaNonFunziona = await authenticate({ username: "mario", password: "Vecchia-123" }, { accountRepository: repo, hasher: realHasher });
  check("e la vecchia non funziona più", vecchiaNonFunziona === null);
}

// ─── manageAccounts() ────────────────────────────────────────────────────────

section("createAccount() / resetAccountPassword()");
{
  const repo = fakeRepository();

  let errore = null;
  try {
    await createAccount({ username: "nuovo", password: "corta", ruolo: "staff", attore: "sysadmin" }, { accountRepository: repo, hasher: realHasher });
  } catch (e) { errore = e; }
  check("creazione con password corta -> rifiutata prima di toccare il repository", /almeno 8 caratteri/.test(errore?.message || ""));
  check("e infatti non ha creato nulla", repo._rows.size === 0);

  const creato = await createAccount({ username: "nuovo", password: "Password-123", ruolo: "staff", attore: "sysadmin" }, { accountRepository: repo, hasher: realHasher });
  check("creazione valida riesce", creato?.ok === true);

  const login = await authenticate({ username: "nuovo", password: "Password-123" }, { accountRepository: repo, hasher: realHasher });
  check("il nuovo account fa login con la password data in creazione", login === "staff");

  errore = null;
  try {
    await resetAccountPassword({ id: creato.id, password: "x" }, { accountRepository: repo, hasher: realHasher });
  } catch (e) { errore = e; }
  check("reset con password corta -> rifiutato", /almeno 8 caratteri/.test(errore?.message || ""));
}

// ─── Policy di autorizzazione ────────────────────────────────────────────────

section("authorize() — policy del modulo Identity");
{
  const fdo = { u: "mario", r: "fdo" };
  const staff = { u: "luigi", r: "staff" };
  const sistemista = { u: "peach", r: "sistemista" };
  const delegato = { u: "toad", r: "delegato" };

  check("FDO non può creare account", authorize(fdo, "accountCreate") === false);
  check("staff non può creare account", authorize(staff, "accountCreate") === false);
  check("delegato non può creare account", authorize(delegato, "accountCreate") === false);
  check("sistemista può creare account", authorize(sistemista, "accountCreate") === true);
  check("sistemista può elencare account", authorize(sistemista, "accountList") === true);

  check("chiunque autenticato può cambiare la propria password", authorize(fdo, "accountChangeOwnPassword") === true);
  check("anche il delegato può cambiare la propria password", authorize(delegato, "accountChangeOwnPassword") === true);
  check("nessuno non autenticato può cambiare password", authorize(null, "accountChangeOwnPassword") === false);

  check("azione di un altro modulo -> null (non 'affar mio', non un divieto)",
    authorize(sistemista, "setMachineStatus") === null);

  check("isSysadmin", isSysadmin(sistemista) === true && isSysadmin(fdo) === false);
  check("isStaff", isStaff(staff) === true && isStaff(sistemista) === false);
  check("isDelegato", isDelegato(delegato) === true && isDelegato(sistemista) === false && isDelegato(null) === false);
  check("ruolo sconosciuto respinto dalla whitelist", isValidRole("portineria") === false);
  check("delegato è un ruolo valido", isValidRole("delegato") === true);
}

// ─── Token di sessione ───────────────────────────────────────────────────────

section("issueToken() / readToken()");
{
  const secret = "segreto-di-test-non-reale";
  const token = issueToken("mario", "fdo", secret);

  const claims = readToken(token, secret);
  check("un token valido si rilegge", claims?.u === "mario" && claims?.r === "fdo");

  check("un token firmato con un altro segreto viene rifiutato", readToken(token, "altro-segreto") === null);

  const [body] = token.split(".");
  check("un token manomesso (firma non combacia) viene rifiutato",
    readToken(`${body}.firma-inventata`, secret) === null);

  // Ruolo non nella whitelist: simula un vecchio token con un nome di ruolo
  // dismesso ("portineria" prima di diventare "fdo").
  const tokenRuoloVecchio = issueToken("mario", "portineria", secret);
  check("un token con un ruolo fuori whitelist viene rifiutato", readToken(tokenRuoloVecchio, secret) === null);

  check("senza segreto configurato, nessun token è valido", readToken(token, null) === null);
}

// ─── Revoca della sessione ───────────────────────────────────────────────────
//
// Il token dura 12 ore e readToken() non sa nulla del database: è questa
// regola a dire che un cookie ancora firmato bene non vale più, perché nel
// frattempo l'account è stato disattivato o eliminato. Senza, "Disattiva"
// nella scheda Account non buttava fuori nessuno fino alla scadenza.

section("sessioneAncoraValida()");
{
  check("account attivo: sessione valida",
    sessioneAncoraValida({ id: 1, attivo: true }) === true);

  check("account disattivato: sessione non più valida",
    sessioneAncoraValida({ id: 1, attivo: false }) === false);

  check("account eliminato (nessuna riga): sessione non più valida",
    sessioneAncoraValida(null) === false);

  check("riga senza id: sessione non più valida",
    sessioneAncoraValida({ attivo: true }) === false);

  // Si nega solo davanti a un "no" esplicito: una riga senza il campo non
  // deve sloggiare nessuno per una lettura parziale.
  check("riga senza il campo attivo: sessione valida",
    sessioneAncoraValida({ id: 1 }) === true);
}

// ─── Esito ───────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
