export async function getOverview(_input, { opsRepository }) {
  return opsRepository.overview();
}
