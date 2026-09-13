// Use-case: segna una macchina fuori/in servizio.
//
// Il fuori servizio rende lo stato visibile a tutti ma NON blocca le
// prenotazioni: chi prenota vede un avviso e decide (warning:'oos').
//
// Fedele all'originale: nessuna validazione di formato su room/machine qui —
// set_machine_status in SQL filtra da sé sulle macchine "bookable" esistenti
// (una macchina inventata resta 'oos' e basta, vedi admin/data.js originale
// e il test che lo verifica). L'autorizzazione (staff escluso) è compito di
// domain/policy.js, non di questo file.

export async function adminSetMachineStatus({ room, machine, oos }, { laundryRepository }) {
  return laundryRepository.setMachineStatus({
    room: String(room || ""), machine: String(machine || ""), oos: Boolean(oos),
  });
}
