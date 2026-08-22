// Autenticazione del pannello admin.
//
// Gli account vivono nella tabella `admin_account` (migrazione 008): il
// sistemista li crea, disattiva e reimposta dal pannello. Le tre variabili
// d'ambiente storiche (FDO/STAFF/SYSADMIN_USER e _PASSWORD_HASH) sono state
// il meccanismo originale, tenuto come rete di sicurezza durante la
// migrazione; con tutti gli account passati al database, quella rete e'
// stata tolta di proposito (migrazione 011 in produzione) — un vecchio
// account via env var non entra piu', anche se le variabili sono ancora
// impostate su Vercel.
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

/**
 * Lo staff prenota e libera turni per conto della Direzione come l'FDO, ma
 * non vede macchine fuori servizio ne' segnalazioni: quelle restano affari
 * della portineria (FDO) e del sistemista.
 */
export function isStaff(claims) {
  return claims?.r === "staff";
}

// Il segreto di sessione e' l'unica cosa ancora necessaria per accettare un
// login: senza, non c'e' modo di firmare il cookie qualunque sia la fonte
// dell'account.
export function adminConfigured() {
  return Boolean(process.env.ADMIN_SESSION_SECRET);
}

// Hash fisso, di nessun account: serve solo a far passare verifyPassword()
// dal suo ramo piu' lento (scrypt) anche quando l'username cercato nella
// tabella account non esiste, cosi' un utente sconosciuto non risponde piu'
// in fretta di uno esistente con password sbagliata.
const HASH_FASULLO = `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`;

/**
 * Riconosce l'utente e ne restituisce il ruolo, leggendo la tabella
 * `admin_account`. L'account deve esistere ed essere attivo.
 *
 * Se il database non risponde l'accesso fallisce: non c'e' piu' una rete di
 * sicurezza via env var che lo aggiri. E' una scelta esplicita — un login
 * ancora possibile con una password "storica" quando qualcuno l'ha appena
 * cambiata dal pannello era la falla, non la sicurezza.
 */
export async function authenticate(username, password) {
  let row = null;
  try {
    row = await rpc("account_by_username", { p_username: username });
  } catch {
    return null;
  }

  if (!row?.id) {
    // Utente inesistente: si passa comunque da scrypt, con lo stesso costo
    // di una password sbagliata su un account vero, cosi' il tempo di
    // risposta non rivela quali username esistono.
    verifyPassword(password, HASH_FASULLO);
    return null;
  }

  if (!row.attivo) return null;
  return verifyPassword(password, row.password_hash) ? row.ruolo : null;
}
