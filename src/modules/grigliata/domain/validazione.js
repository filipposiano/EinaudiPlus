// Regole di forma del modulo Grigliata — validazioni PRIMA di spendere una
// chiamata di rete, stesso principio di linen-change/domain/schedule.js. La
// verità finale resta comunque nelle funzioni SQL (grigliata_iscrivi,
// grigliata_admin_crea), che rifiutano da sole se questo controllo venisse
// aggirato chiamando l'RPC direttamente.

// "classico" è "mangio tutto": il valore resta quello di prima perché è già
// salvato nelle adesioni esistenti, cambia solo come lo chiama l'interfaccia.
export const MENU = new Set(["classico", "vegetariano", "vegano"]);

export function isValidMenu(v) {
  return MENU.has(v);
}

/** Stesso tetto del vincolo `check` sulla colonna `note` in SQL. */
export const NOTE_MAX = 300;

/**
 * `v` è una data/ora nel futuro? Accetta qualunque stringa che `Date` sappia
 * interpretare (l'input del form è un `<input type="datetime-local">`, che
 * produce "2026-10-03T18:30").
 */
export function isFutureDateTime(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) && t > Date.now();
}
