// Use-case: segna una macchina fuori/in servizio.
//
// Il fuori servizio rende lo stato visibile a tutti ma NON blocca le
// prenotazioni: chi prenota vede un avviso e decide (warning:'oos').
//
// `room` qui identifica quale lavanderia fisica (Manica/Valentino), sempre
// un numero di camera vero — validato, chiusura di un'asimmetria segnalata
// nell'audit. `machine` resta libero apposta: set_machine_status in SQL
// filtra da sé sulle macchine "bookable" esistenti (una macchina inventata
// resta 'oos' e basta, verificato dalla suite di test). L'autorizzazione
// (staff escluso) è compito di domain/policy.js, non di questo file.

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";

export async function adminSetMachineStatus({ room, machine, oos }, { laundryRepository }) {
  const parsedRoom = parseRoomNumber(room);
  if (!parsedRoom) throw new ValidationError("camera non valida");

  return laundryRepository.setMachineStatus({
    room: parsedRoom, machine: String(machine || ""), oos: Boolean(oos),
  });
}
