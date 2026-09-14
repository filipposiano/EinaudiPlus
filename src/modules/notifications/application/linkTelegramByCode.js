// Use-case: collega una chat Telegram a una camera tramite il codice.

export async function linkTelegramByCode({ code, chatId }, { notificationsRepository }) {
  return notificationsRepository.telegramLink({ code, chatId });
}
