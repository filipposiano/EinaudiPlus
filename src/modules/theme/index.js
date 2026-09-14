// Superficie pubblica del modulo Theme — l'UNICO file che un altro modulo o
// un adapter in api/ può importare.
//
// Dominio coperto: lettura/scrittura del tema stagionale attivo, entrambe
// azioni del pannello admin (sistemista). La lettura lato residenti non
// passa da qui: è già inclusa nella risposta di laundry_snapshot (il campo
// `tema`), letta dal modulo Laundry — nessun endpoint separato da duplicare.

import { themeRepository } from "./infrastructure/themeRepository.js";
import { getTheme as _getTheme } from "./application/getTheme.js";
import { setTheme as _setTheme } from "./application/setTheme.js";

export { authorize } from "./domain/policy.js";
export { TEMI, isValidTheme } from "./domain/theme.js";

const deps = { themeRepository };

export async function getTheme() {
  return _getTheme({}, deps);
}

export async function setTheme(tema) {
  return _setTheme({ tema }, deps);
}
