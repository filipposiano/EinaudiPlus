export async function getCounts(_input, { opsRepository }) {
  return opsRepository.counts();
}
