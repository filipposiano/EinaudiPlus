export async function adminListTelegramSubs(_input, { notificationsRepository }) {
  return notificationsRepository.adminListTelegramSubs();
}
