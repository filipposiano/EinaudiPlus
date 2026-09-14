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
// un'app che non prenota più (stessa scelta di sempre). Con un'eccezione
// dichiarata: chi passa `failOpen: false` sceglie il contrario — vedi sotto.

import { rpc } from "../db/rpcClient.js";

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

/**
 * @param {string} bucket nome del limite (es. "laundry", "admin-login", "broadcast")
 * @param {string} identifier chi viene limitato (IP o username) — il chiamante decide quale
 * @param {{ failOpen?: boolean }} [opzioni] `failOpen: false` per negare, invece di
 *   concedere, quando è il controllo stesso a non funzionare (default: true)
 * @returns {Promise<boolean>} true = si può procedere, false = limite superato
 *
 * Il default fail-open vale per le azioni degli utenti: se Supabase ha un
 * singhiozzo, il prezzo del fail-closed sarebbe "nessuno prenota più il
 * bucato" — sproporzionato rispetto all'abuso che il limite previene.
 *
 * Sul login amministrativo il conto è rovesciato, ed è il motivo di questo
 * parametro. Fail-closed durante un guasto costa un pannello inaccessibile
 * per qualche minuto — ma col database giù il pannello non potrebbe fare
 * nulla comunque, ogni sua azione finisce lì. Fail-open costa invece la
 * sparizione silenziosa dell'unica difesa contro la forza bruta, per di più
 * in una condizione che un attaccante può in parte provocare: basta un
 * database lento o sotto carico perché il catch scatti e il limite si
 * spenga. Dietro resta scrypt, che rende ogni tentativo costoso, ma è una
 * rete che rallenta — non una che ferma.
 */
export async function checkRateLimit(bucket, identifier, limit, windowSecs, { failOpen = true } = {}) {
  try {
    return await rpc("rl_hit", {
      p_bucket: `${bucket}:${identifier}`,
      p_limit: limit,
      p_window_secs: windowSecs,
    });
  } catch {
    return failOpen;
  }
}
