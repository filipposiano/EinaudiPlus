// Autenticazione del pannello admin.
//
// Un solo account condiviso: non c'e' una tabella utenti perche' non ci sono
// utenti da gestire. La password si cambia rigenerando l'hash e aggiornando la
// variabile d'ambiente su Vercel.
//
// scrypt invece di bcrypt: e' nella libreria standard di Node, quindi zero
// dipendenze da mantenere e nessun modulo nativo che si rompe in build.

import crypto from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_HOURS = 12;
const COOKIE = "adm";

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

export function issueToken(username) {
  const body = b64(JSON.stringify({
    u: username,
    exp: Date.now() + SESSION_HOURS * 3600_000,
    v: 1,   // alzare questo numero invalida tutte le sessioni in giro
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
    if (claims.v !== 1 || !claims.exp || Date.now() > claims.exp) return null;
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

export function adminConfigured() {
  return Boolean(
    process.env.ADMIN_USER &&
    process.env.ADMIN_PASSWORD_HASH &&
    process.env.ADMIN_SESSION_SECRET
  );
}
