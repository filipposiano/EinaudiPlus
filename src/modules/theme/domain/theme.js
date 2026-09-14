// Temi stagionali disponibili.
//
// Decorazione dell'app lato residenti (Halloween, Natale con la neve...):
// la legge laundry_snapshot a ogni avvio dell'app (vive in una riga sola nel
// database, app_theme — nessun canale a parte per i residenti), e la
// accende/spegne il sistemista in qualsiasi momento dal pannello.

export const TEMI = new Set(["nessuno", "halloween", "natale"]);

export function isValidTheme(v) {
  return TEMI.has(v);
}
