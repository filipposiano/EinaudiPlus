// Use-case: codice usa-e-getta da incollare al bot Telegram per collegare la
// chat a una camera. Serve un codice e non basta la camera: altrimenti
// chiunque potrebbe scrivere al bot "sono la 112" e ricevere i promemoria
// di un altro.
//
// Fedele all'originale: nessuna validazione di formato sulla camera qui —
// la funzione SQL la respinge da sé (verificato nella suite di test
// esistente, che manda una camera invalida e si aspetta ok:false).

export async function createTelegramCode({ room }, { notificationsRepository }) {
  return notificationsRepository.createTelegramCode({ room });
}
