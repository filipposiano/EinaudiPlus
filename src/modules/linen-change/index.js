// Superficie pubblica del modulo Linen Change — l'UNICO file che un altro
// modulo o un adapter in api/ può importare.
//
// Dominio coperto: l'ancora (data + tipo) da cui si calcola, per alternanza
// settimanale, se un dato martedì è cambio biancheria grande o piccolo.
// Entrambe azioni del pannello admin (FDO e sistemista, non lo staff — vedi
// domain/policy.js).
//
// La lettura lato residenti non passa da qui: è già inclusa nella risposta
// di laundry_snapshot (il campo `cambio_biancheria`, risolto in SQL da
// linen_change_current()), letta dal modulo Laundry — stessa scelta già
// fatta per il tema stagionale, nessun endpoint da duplicare.

import { linenChangeRepository } from "./infrastructure/linenChangeRepository.js";
import { getLinenChangeAnchor as _getLinenChangeAnchor } from "./application/getLinenChangeAnchor.js";
import { setLinenChangeAnchor as _setLinenChangeAnchor } from "./application/setLinenChangeAnchor.js";

export { authorize } from "./domain/policy.js";
export { TIPI, isValidTipo } from "./domain/schedule.js";

const deps = { linenChangeRepository };

export async function getLinenChangeAnchor() {
  return _getLinenChangeAnchor({}, deps);
}

export async function setLinenChangeAnchor(data, tipo) {
  return _setLinenChangeAnchor({ data, tipo }, deps);
}
