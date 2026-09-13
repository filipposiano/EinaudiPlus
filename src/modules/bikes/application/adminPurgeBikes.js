// Cancellazione totale — usata per il reset annuale. Distruttivo per
// design (come nell'originale): l'autorizzazione (solo sistemista) è
// compito di domain/policy.js, non di questo file.
export async function adminPurgeBikes(_input, { bikeRepository }) {
  return bikeRepository.purge();
}
