// Use-case: legge l'ancora configurata (pannello admin).
//
// Torna l'ancora GREZZA (data + tipo salvati), non il tipo già risolto per
// oggi: il form deve ripartire da cosa è stato salvato l'ultima volta, non
// da un valore ricalcolato — vedi linen_change_admin_get() in SQL.

export async function getLinenChangeAnchor(_input, { linenChangeRepository }) {
  return linenChangeRepository.adminGet();
}
