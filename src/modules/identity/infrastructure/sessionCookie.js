// Cookie di sessione admin. Restano qui (non in shared/http) perché il nome
// del cookie, la sua durata e i suoi flag sono decisioni del dominio Identity
// (quanto dura una sessione admin), non un dettaglio HTTP generico.

import { SESSION_HOURS_EXPORTED as SESSION_HOURS } from "./sessionToken.js";

const COOKIE = "adm";

export function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", [
    `${COOKIE}=${token}`,
    "HttpOnly",        // invisibile a document.cookie: niente furto via XSS
    "Secure",
    "SameSite=Strict", // il pannello è same-origin, quindi copre il CSRF
    "Path=/",
    `Max-Age=${SESSION_HOURS * 3600}`,
  ].join("; "));
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
}

export function readSessionCookie(req) {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}
