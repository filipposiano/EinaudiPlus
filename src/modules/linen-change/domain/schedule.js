// Regole del cambio biancheria del martedì mattina (grande o piccolo).
//
// L'alternanza settimanale vera e propria (pari/dispari rispetto a un'ancora)
// vive in SQL (vedi supabase/cambio-biancheria.sql, linen_change_type_for):
// è lì che deve stare, perché "quale martedì è oggi" è una domanda a cui solo
// il server può rispondere in modo uguale per tutti, indipendentemente
// dall'orologio del singolo dispositivo — la stessa ragione per cui
// laundry_preview_active() vive in SQL e non in modello.ts.
//
// Qui restano solo le validazioni di forma, PRIMA di spendere una chiamata di
// rete: stesso principio di theme/domain/theme.js.

export const TIPI = new Set(["grande", "piccolo"]);

export function isValidTipo(v) {
  return TIPI.has(v);
}

/**
 * `data` è un martedì, nel senso del calendario (non del fuso del server)?
 *
 * Usa `getUTCDay()` e non `getDay()`: un ambiente serverless gira in UTC, ma
 * scrivere il controllo così non dipende da quale fuso ha il processo che lo
 * esegue — a differenza di `getDay()`, che leggerebbe il fuso locale del
 * runtime. `T00:00:00Z` ancora la data a mezzanotte UTC, così una stringa
 * come "2026-09-15" non scivola sul giorno prima o dopo per effetto del fuso.
 *
 * La verità finale resta comunque quella di `linen_change_set_anchor()` in
 * SQL (`extract(isodow from ...)`), che rifiuta la scrittura se questo
 * controllo venisse aggirato chiamando l'RPC direttamente: qui si evita solo
 * di far viaggiare una richiesta destinata a fallire.
 */
export function isTuesdayISO(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) return false;
  const d = new Date(`${data}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.getUTCDay() === 2;
}
