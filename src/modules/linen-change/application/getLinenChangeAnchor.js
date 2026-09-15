// Use-case: legge l'ancora configurata (pannello admin).
//
// Torna l'ancora GREZZA (data + tipo salvati), non il tipo già risolto per
// oggi: il form deve ripartire da cosa è stato salvato l'ultima volta, non
// da un valore ricalcolato — vedi linen_change_admin_get() in SQL.

import { fromRpcError } from "../../../shared/errors/AppError.js";

export async function getLinenChangeAnchor(_input, { linenChangeRepository }) {
  try {
    return await linenChangeRepository.adminGet();
  } catch (err) {
    // fromRpcError() esiste apposta per questo (vedi il suo commento in
    // AppError.js) ma prima d'ora non la chiamava nessuno: senza,
    // wrapHandler mostra sempre il messaggio generico "errore del server,
    // riprova" per QUALSIASI fallimento della RPC — anche quando il
    // messaggio di PostgREST è già la diagnosi (es. "la funzione non
    // esiste", una migrazione non ancora applicata). Sicuro solo perché
    // questo use-case è raggiungibile unicamente dal pannello admin, mai da
    // un endpoint pubblico: expose:true qui non mostra nulla a un estraneo.
    throw fromRpcError(err, { exposeToClient: true });
  }
}
