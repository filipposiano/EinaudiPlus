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
 */
export function wrapHandler(moduleName, handler) {
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
          err.expose ? err.message : "errore del server, riprova",
          err.expose ? err.extra : {},
          err.status,
        );
      }

      // Errore imprevisto: mai il suo messaggio al client, sempre nel log.
      log.error("errore non gestito", {
        module: moduleName, message: err.message, stack: err.stack,
      });
      return fail(res, "errore del server, riprova", {}, 500);
    }
  };
}
