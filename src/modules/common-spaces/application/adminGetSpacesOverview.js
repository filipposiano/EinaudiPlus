// Use-case: panoramica di tutte le sale per il pannello admin.

export async function adminGetSpacesOverview(_input, { commonSpacesRepository }) {
  return commonSpacesRepository.adminOverview();
}
