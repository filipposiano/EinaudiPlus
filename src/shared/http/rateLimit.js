// Rate limiting condiviso, in Postgres — sostituisce l'`allow()` di
// api/_lib/http.js, richiamato a mano (e diversamente) in ogni endpoint.
//
// Un'unica funzione, un solo punto da testare e verificare: prima ogni
// adapter reimplementava la stessa chiamata a `rl_hit`, ognuno con le
// proprie convenzioni — qui il bucket e l'identificatore (IP per gli
// endpoint pubblici, username per un limite "per account" come il
// broadcast) sono parametri espliciti, non impliciti nella firma di `allow`.
//
// Fail-open su errore del database: meglio un limite non applicato che
// un'app che non prenota più (stessa scelta di sempre).

import { rpc } from "../db/rpcClient.js";

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

/**
 * @param {string} bucket nome del limite (es. "laundry", "admin-login", "broadcast")
 * @param {string} identifier chi viene limitato (IP o username) — il chiamante decide quale
 * @returns {Promise<boolean>} true = si può procedere, false = limite superato
 */
export async function checkRateLimit(bucket, identifier, limit, windowSecs) {
  try {
    return await rpc("rl_hit", {
      p_bucket: `${bucket}:${identifier}`,
      p_limit: limit,
      p_window_secs: windowSecs,
    });
  } catch {
    return true;
  }
}
