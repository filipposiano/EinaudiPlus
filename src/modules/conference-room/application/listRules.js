export async function listRules(_input, { conferenceRepository }) {
  return conferenceRepository.rules();
}
