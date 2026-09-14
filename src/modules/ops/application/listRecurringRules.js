export async function listRecurringRules(_input, { opsRepository }) {
  return opsRepository.recurringList();
}
