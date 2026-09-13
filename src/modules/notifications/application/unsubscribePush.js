// Use-case: disiscrizione push.

export async function unsubscribePush({ endpoint }, { notificationsRepository }) {
  return notificationsRepository.removePushSub({ endpoint: String(endpoint || "") });
}
