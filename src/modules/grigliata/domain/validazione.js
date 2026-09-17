// Regole di forma del modulo Grigliata — validazioni PRIMA di spendere una
// chiamata di rete, stesso principio di linen-change/domain/schedule.js. La
// verità finale resta comunque nelle funzioni SQL (grigliata_iscrivi,
// grigliata_admin_crea), che rifiutano da sole se questo controllo venisse
// aggirato chiamando l'RPC direttamente.

export const MENU = new Set(["classico", "vegano"]);

export function isValidMenu(v) {
  return MENU.has(v);
}

/**
 * `v` è una data/ora nel futuro? Accetta qualunque stringa che `Date` sappia
 * interpretare (l'input del form è un `<input type="datetime-local">`, che
 * produce "2026-10-03T18:30").
 */
export function isFutureDateTime(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) && t > Date.now();
}
