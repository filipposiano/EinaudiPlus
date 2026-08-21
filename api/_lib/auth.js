// Autenticazione del pannello admin.
//
// Gli account vivono nella tabella `admin_account` (migrazione 008): il
// sistemista li crea, disattiva e reimposta dal pannello. Le tre variabili
// d'ambiente storiche (FDO/STAFF/SYSADMIN_USER e _PASSWORD_HASH) restano
// come rete di sicurezza — vedi authenticate() piu' sotto.
//
// scrypt invece di bcrypt: e' nella libreria standard di Node, quindi zero
// dipendenze da mantenere e nessun modulo nativo che si rompe in build.

import crypto from "node:crypto";
import { rpc } from "./db.js";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_HOURS = 12;
const COOKIE = "adm";

/**
 * I ruoli riconosciuti.
 *
 * `fdo` e `staff` hanno gli stessi poteri: macchine, segnalazioni, prenotazioni
 * per la Direzione, sala conferenze. Restano due account distinti e non uno
 * condiviso perche' l'audit log registra CHI ha fatto cosa, e "l'ha fatto la
 * portineria" e "l'ha fatto lo staff" sono due risposte diverse quando si va a
 * capire perche' una macchina risulta guasta.
 *
 * `sistemista` puo' in piu' le regole ricorrenti e la pulizia dei dati.
 *
 * Un token con un ruolo che non e' in questa lista viene rifiutato: e' cosi'
 * che i vecchi cookie con ruolo "portineria" (il nome di prima) hanno smesso
 * di valere senza dover alzare la versione del token.
 */
const RUOLI = new Set(["fdo", "staff", "sistemista"]);

// ─── Password ────────────────────────────────────────────────────────────────

/** Formato: scrypt$<salt hex>$<hash hex> */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, keyHex] = String(stored || "").split("$");
    if (scheme !== "scrypt" || !saltHex || !keyHex) return false;

    const expected = Buffer.from(keyHex, "hex");
    const actual = crypto.scryptSync(
      password, Buffer.from(saltHex, "hex"), expected.length, SCRYPT
    );
    // timingSafeEqual e non ===: il confronto ingenuo esce al primo byte
    // diverso, e il tempo impiegato rivela quanti caratteri erano giusti.
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ─── Sessione ────────────────────────────────────────────────────────────────
//
// Token firmato HMAC, non JWT: serve dire "questa sessione e' valida fino a
// quest'ora" e nient'altro. Una libreria JWT aggiungerebbe superficie senza
// aggiungere garanzie.

const b64 = (buf) => Buffer.from(buf).toString("base64url");

function sign(payload) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueToken(username, role) {
  const body = b64(JSON.stringify({
    u: username,
    r: role,   // 'fdo' | 'sistemista'
    exp: Date.now() + SESSION_HOURS * 3600_000,
    v: 2,   // alzare questo numero invalida tutte le sessioni in giro
  }));
  return `${body}.${sign(body)}`;
}

export function readToken(token) {
  if (!process.env.ADMIN_SESSION_SECRET) return null;
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;

  const expected = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (expected.length !== got.length) return null;
  if (!crypto.timingSafeEqual(expected, got)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (claims.v !== 2 || !claims.exp || Date.now() > claims.exp) return null;
    // Un vecchio token con ruolo 'portineria' (nome precedente dell'account
    // FDO) non è più valido qui e va ri-autenticato: non c'è bisogno di
    // alzare la versione, la whitelist stessa lo respinge già.
    if (!RUOLI.has(claims.r)) return null;
    return claims;
  } catch {
    return null;
  }
}

// ─── Cookie ──────────────────────────────────────────────────────────────────

export function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", [
    `${COOKIE}=${token}`,
    "HttpOnly",              // invisibile a document.cookie: niente furto via XSS
    "Secure",
    "SameSite=Strict",       // il pannello e' same-origin, quindi copre il CSRF
    "Path=/",
    `Max-Age=${SESSION_HOURS * 3600}`,
  ].join("; "));
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
}

function readCookie(req, name) {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** Le claim della sessione, o null. Da chiamare per prima cosa in ogni /api/admin. */
export function currentAdmin(req) {
  return readToken(readCookie(req, COOKIE));
}

/** Il sistemista può tutto ciò che può l'FDO, più il resto. */
export function isSysadmin(claims) {
  return claims?.r === "sistemista";
}

export function adminConfigured() {
  return Boolean(
    process.env.ADMIN_SESSION_SECRET &&
    ((process.env.FDO_USER && process.env.FDO_PASSWORD_HASH) ||
     (process.env.STAFF_USER && process.env.STAFF_PASSWORD_HASH) ||
     (process.env.SYSADMIN_USER && process.env.SYSADMIN_PASSWORD_HASH))
  );
}

// Hash fisso, di nessun account: serve solo a far passare verifyPassword()
// dal suo ramo piu' lento (scrypt) anche quando l'username cercato nella
// tabella account non esiste, cosi' un utente sconosciuto non risponde piu'
// in fretta di uno esistente con password sbagliata.
const HASH_FASULLO = `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`;

/**
 * Riconosce l'utente e ne restituisce il ruolo.
 *
 * Due fonti, controllate entrambe sempre:
 *  1. La tabella `admin_account`, dove il sistemista crea e gestisce gli
 *     account dal pannello.
 *  2. Le tre variabili d'ambiente storiche (FDO/STAFF/SYSADMIN), che restano
 *     come rete di sicurezza: se il database non risponde, o la tabella e'
 *     ancora vuota subito dopo la migrazione, non si resta tutti fuori.
 *
 * Le password si verificano SEMPRE entrambe le fonti, anche quando l'username
 * non corrisponde a nessuna: uscire prima renderebbe il tempo di risposta un
 * indizio su quali account esistono. (La rete verso Supabase introduce comunque
 * una variabilita' di per se', ma non e' un motivo per smettere di provarci.)
 */
export async function authenticate(username, password) {
  let dbRole = null;
  try {
    const row = await rpc("account_by_username", { p_username: username });
    if (row?.id) {
      const ok = verifyPassword(password, row.password_hash);
      if (ok && row.attivo) dbRole = row.ruolo;
    } else {
      verifyPassword(password, HASH_FASULLO);
    }
  } catch {
    // Database irraggiungibile: si scende comunque al controllo delle env
    // var qui sotto, che e' pensato apposta per non dipendere dal database.
  }

  const accounts = [
    { user: process.env.FDO_USER, hash: process.env.FDO_PASSWORD_HASH, role: "fdo" },
    { user: process.env.STAFF_USER, hash: process.env.STAFF_PASSWORD_HASH, role: "staff" },
    { user: process.env.SYSADMIN_USER, hash: process.env.SYSADMIN_PASSWORD_HASH, role: "sistemista" },
  ];

  let envRole = null;
  for (const a of accounts) {
    if (!a.user || !a.hash) continue;
    const ok = verifyPassword(password, a.hash);
    if (ok && a.user === username) envRole = a.role;
  }

  return dbRole || envRole;
}
