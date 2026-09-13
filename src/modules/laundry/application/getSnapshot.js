// Use-case: la griglia della lavanderia (settimana + stato macchine).
//
// Senza camera si ricade sulla lavanderia principale — stesso comportamento
// di sempre (era `return API_URL` nel client Apps Script, poi `p_room: null`
// nell'RPC): laundry_for_room() in SQL decide quale, non questo file.

export async function getSnapshot({ room }, { laundryRepository }) {
  const trimmed = room ? String(room).trim() : "";
  return laundryRepository.snapshot(trimmed || null);
}
