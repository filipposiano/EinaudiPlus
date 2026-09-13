// Errore applicativo che sa da solo con quale HTTP status rispondere e se il
// proprio messaggio è sicuro da mostrare al client.
//
// Perché "expose" e non "mostra sempre" o "nascondi sempre": admin/data.js
// nel codice attuale rivela err.message perché chi arriva lì ha già superato
// l'autenticazione admin, e il messaggio di PostgREST è spesso già la diagnosi
// ("DELETE requires a WHERE clause"). Quella scelta resta valida — la si
// esprime qui marcando l'errore come `expose: true` invece di lasciare che
// QUALSIASI eccezione non gestita finisca nella risposta, che è il difetto
// vero: un bug imprevisto nel codice non deve mai uscire come stack trace.

export class AppError extends Error {
  constructor(message, { status = 500, code = "internal_error", expose = false, extra = {} } = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.expose = expose;
    this.extra = extra;
  }
}

/** 401 — nessuna sessione valida. */
export class UnauthenticatedError extends AppError {
  constructor(message = "non autenticato") {
    super(message, { status: 401, code: "unauthenticated", expose: true });
  }
}

/** 403 — sessione valida, ma senza i permessi per questa azione. */
export class ForbiddenError extends AppError {
  constructor(message = "permesso negato") {
    super(message, { status: 403, code: "forbidden", expose: true });
  }
}

/** 400 — input rifiutato dalla validazione, prima di toccare il database. */
export class ValidationError extends AppError {
  constructor(message) {
    super(message, { status: 400, code: "validation_error", expose: true });
  }
}

/**
 * Avvolge un errore proveniente da una dipendenza esterna (RPC/Supabase),
 * marcandolo esplicitamente come "sicuro da mostrare" quando il chiamante è
 * già un admin autenticato — stessa logica di oggi, ma esplicita invece che
 * implicita nel catch di ogni singolo endpoint.
 */
export function fromRpcError(err, { exposeToClient = false } = {}) {
  const wrapped = new AppError(err.message, {
    status: err.status && err.status >= 400 && err.status < 600 ? err.status : 500,
    code: "rpc_error",
    expose: exposeToClient,
  });
  wrapped.rpc = err.rpc;
  wrapped.cause = err;
  return wrapped;
}
