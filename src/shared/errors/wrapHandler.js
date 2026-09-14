// Punto unico di gestione errori per ogni adapter Vercel in api/*.js.
//
// Risolve l'audit finding #2: oggi ogni endpoint reimplementa il proprio
// try/catch, e admin/data.js restituisce err.message grezzo al client per
// QUALSIASI eccezione, incluso un bug imprevisto nel codice — non solo per
// gli errori RPC che era l'intento originale (vedi commento in quel file).
//
// Qui: un AppError con `expose:true` mostra il proprio messaggio (stesso
// comportamento di oggi per gli errori RPC verso un admin già autenticato);
// qualunque altro errore — un bug, un TypeError, qualsiasi cosa non prevista —
// risponde SEMPRE con un messaggio generico, e il dettaglio vero finisce solo
// nel log strutturato.

import { AppError } from "./AppError.js";
import { fail } from "../http/response.js";
import { createLogger } from "../logging/logger.js";

const logger = createLogger("http");

function requestId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * @param {string} moduleName nome del modulo/endpoint, per i log
 * @param {(req, res, ctx: {log: object, requestId: string}) => Promise<void>} handler
 * @param {object} [opts]
 * @param {boolean} [opts.exposeInternalErrors=false] Se true, un errore NON
 *   tipizzato (bug imprevisto, errore RPC grezzo) mostra comunque il proprio
 *   messaggio al client invece del messaggio neutro — riservato agli
 *   endpoint amministrativi, dove chi arriva qui ha già superato
 *   l'autenticazione e il messaggio di PostgREST è spesso già la diagnosi
 *   (vedi api/admin/data.js originale). Sugli endpoint pubblici resta false:
 *   un estraneo non deve mai vedere un dettaglio interno.
 * @param {string} [opts.genericMessage] Messaggio per gli errori non esposti
 *   (default "errore del server, riprova"; es. cron.js usa "tick fallito").
 */
export function wrapHandler(moduleName, handler, opts = {}) {
  const { exposeInternalErrors = false, genericMessage = "errore del server, riprova" } = opts;

  return async function wrapped(req, res) {
    const reqId = requestId();
    const log = {
      info: (msg, meta = {}) => logger.info(msg, { requestId: reqId, ...meta }),
      warn: (msg, meta = {}) => logger.warn(msg, { requestId: reqId, ...meta }),
      error: (msg, meta = {}) => logger.error(msg, { requestId: reqId, ...meta }),
    };

    try {
      await handler(req, res, { log, requestId: reqId });
    } catch (err) {
      if (err instanceof AppError) {
        log.warn("richiesta rifiutata", {
          module: moduleName, code: err.code, status: err.status, rpc: err.rpc,
          detail: err.message, // il dettaglio va sempre nel log, esposto o no
        });
        return fail(
          res,
          err.expose ? err.message : genericMessage,
          err.expose ? err.extra : {},
          err.status,
        );
      }

      // Errore imprevisto: nei log sempre col dettaglio pieno. Al client,
      // il dettaglio solo se questo endpoint lo ha dichiarato esplicitamente
      // sicuro da mostrare (admin già autenticato) — altrimenti il generico.
      log.error("errore non gestito", {
        module: moduleName, message: err.message, stack: err.stack, rpc: err.rpc,
      });
      if (exposeInternalErrors) {
        return fail(res, "errore del server: " + err.message, { rpc: err.rpc }, 500);
      }
      return fail(res, genericMessage, {}, 500);
    }
  };
}
