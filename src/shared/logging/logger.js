// Logger strutturato minimo: una riga JSON per evento, sempre con modulo e
// request id, invece di console.error("[tag]", ...) sparso e diverso in ogni
// file (vedi ARCHITETTURA-ENTERPRISE.md, punto 7 dell'audit).
//
// Deliberatamente senza dipendenze esterne (niente pino/winston): lo scopo qui
// è la forma del log (JSON, campi fissi), non le funzionalità avanzate — se
// servirà log shipping/livelli dinamici in futuro, si sostituisce l'implementazione
// dietro questa stessa interfaccia senza toccare i chiamanti.

function write(level, moduleName, msg, meta) {
  const line = {
    ts: new Date().toISOString(),
    level,
    module: moduleName,
    msg,
    ...meta,
  };
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  out(JSON.stringify(line));
}

/**
 * Crea un logger legato a un modulo. `requestId` è opzionale: la si passa nei
 * singoli meta quando disponibile (wrapHandler la genera per ogni richiesta),
 * così le righe di una stessa richiesta si possono correlare a valle.
 */
export function createLogger(moduleName) {
  return {
    info: (msg, meta = {}) => write("info", moduleName, msg, meta),
    warn: (msg, meta = {}) => write("warn", moduleName, msg, meta),
    error: (msg, meta = {}) => write("error", moduleName, msg, meta),
  };
}
