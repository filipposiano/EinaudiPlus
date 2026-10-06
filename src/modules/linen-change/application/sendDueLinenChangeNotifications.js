// Use-case: tick dei promemoria del cambio biancheria, invocato dal cron
// (agganciato allo stesso tick dei promemoria lavanderia — vedi api/cron.js
// e sendDueReminders.js nel modulo Notifications).
//
// Nessuna logica di scheduling qui dentro: "quali camere avvisare adesso"
// lo decide linen_change_claim_due_notifications() in SQL (solo di
// martedì, una volta sola a settimana per camera). Questo use-case compone
// il messaggio e lo spedisce, nient'altro — stesso principio di
// sendDueReminders.js.

const TESTO = {
  grande: "Oggi c'è cambio GRANDE",
  piccolo: "Oggi c'è cambio PICCOLO",
  nessuno: "Questa settimana non c'è cambio biancheria",
};

export async function sendDueLinenChangeNotifications(_input, { linenChangeRepository, notifyRoom }) {
  const esito = await linenChangeRepository.claimDueNotifications();
  const righe = Array.isArray(esito?.righe) ? esito.righe : [];

  if (righe.length === 0) {
    return { ok: true, inviati: 0 };
  }

  const corpo = TESTO[esito.tipo] ?? TESTO.nessuno;

  await Promise.all(
    righe.map((room) => notifyRoom(room, "Cambio biancheria", corpo, "cambio-biancheria")),
  );

  return { ok: true, inviati: righe.length };
}
