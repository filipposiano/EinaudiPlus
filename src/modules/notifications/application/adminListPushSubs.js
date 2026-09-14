export async function adminListPushSubs(_input, { notificationsRepository }) {
  return notificationsRepository.adminListPushSubs();
}
