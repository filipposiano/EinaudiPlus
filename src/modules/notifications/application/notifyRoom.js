// Use-case: avvisa una camera su tutti i canali configurati. Usato dal
// modulo Bikes (bici registrata/rimossa dalla reception) — Bikes non sa
// nulla di push/Telegram, chiama solo questa funzione tramite la superficie
// pubblica di Notifications.

export async function notifyRoom({ room, title, body, tag }, { notificationsRepository, pushSender, telegramSender }) {
  const targets = await notificationsRepository.notifyTargetsForRoom(room).catch(() => null);
  if (!targets) return;

  if (pushSender.configured() && Array.isArray(targets.push) && targets.push.length) {
    const gone = [];
    await Promise.all(targets.push.map(async (s) => {
      const esito = await pushSender.send(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        { title, body, url: "/", tag },
      );
      if (esito === "gone") gone.push(s.id);
    }));
    if (gone.length) await notificationsRepository.prunePushSubs({ ids: gone }).catch(() => {});
  }

  if (telegramSender.configured() && Array.isArray(targets.telegram) && targets.telegram.length) {
    await Promise.all(targets.telegram.map((c) => telegramSender.send(c.chat_id, title, body)));
  }
}
