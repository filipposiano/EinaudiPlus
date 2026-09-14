// Use-case: scollega una chat Telegram (/stop).

export async function unlinkTelegram({ chatId }, { notificationsRepository }) {
  return notificationsRepository.telegramUnlink({ chatId });
}
