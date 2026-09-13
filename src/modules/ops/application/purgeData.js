// `sala` assente = tutte, cioè il comportamento storico. Fedele
// all'originale: nessuna validazione JS su scope/sala — il controllo su
// quali sale esistono resta nella funzione SQL, la stessa che deve
// rifiutare una sala inventata anche a chi chiama senza passare dal
// pannello.

export async function purgeData({ scope, sala }, { opsRepository }) {
  return opsRepository.purge({ scope: String(scope || ""), sala: sala ? String(sala) : null });
}
