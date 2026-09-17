// Use-case: cosa vede un residente sulla scheda Grigliata — se è attiva, i
// suoi dati (titolo, scadenza, link di pagamento), e la propria adesione se
// ne ha già fatta una. Percorso pubblico: nessuna sessione richiesta, la
// camera è autodichiarata come in tutto il resto dell'app.

export async function getStatoPubblico({ room }, { grigliataRepository }) {
  const trimmed = room ? String(room).trim() : "";
  return grigliataRepository.statoPubblico(trimmed);
}
