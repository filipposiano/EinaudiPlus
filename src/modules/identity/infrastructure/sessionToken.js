// Token firmato HMAC, non JWT: serve dire "questa sessione è valida fino a
// quest'ora" e nient'altro — una libreria JWT aggiungerebbe superficie senza
// aggiungere garanzie (motivazione invariata rispetto all'originale).
//
// Il segreto è iniettato come parametro invece che letto da process.env
// dentro la funzione: rende sign/verify testabili senza env var reali, e
// separa "come si firma un token" da "dove vive il segreto" (quella
// decisione resta allo strato application/adapter, tramite shared/config).

import crypto from "node:crypto";
import { isValidRole } from "../domain/roles.js";

const SESSION_HOURS = 12;
const b64 = (buf) => Buffer.from(buf).toString("base64url");

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueToken(username, role, secret) {
  const body = b64(JSON.stringify({
    u: username,
    r: role,
    exp: Date.now() + SESSION_HOURS * 3600_000,
    v: 2, // alzare questo numero invalida tutte le sessioni in giro
  }));
  return `${body}.${sign(body, secret)}`;
}

export function readToken(token, secret) {
  if (!secret) return null;
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;

  const expected = Buffer.from(sign(body, secret));
  const got = Buffer.from(mac);
  if (expected.length !== got.length) return null;
  if (!crypto.timingSafeEqual(expected, got)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (claims.v !== 2 || !claims.exp || Date.now() > claims.exp) return null;
    // Un token con un ruolo che non è più nella whitelist (es. il vecchio
    // "portineria", rinominato in "fdo") viene rifiutato senza dover alzare
    // la versione: la whitelist stessa lo respinge.
    if (!isValidRole(claims.r)) return null;
    return claims;
  } catch {
    return null;
  }
}

export const SESSION_HOURS_EXPORTED = SESSION_HOURS;
