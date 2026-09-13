// Sale comuni riconosciute e limiti della griglia oraria.
//
// A differenza della lavanderia (turni fissi da 75 minuti), qui l'orario è
// in minuti dalla mezzanotte: `start` sta dentro la giornata, `end` può
// arrivare a 2880 perché una fascia che scavalca la mezzanotte si esprime
// come "oltre le 24:00" (stesso principio di 004-oltre-mezzanotte per la
// lavanderia) — il database ricontrolla comunque durata e sovrapposizioni.

export const SPACES = new Set(["cinema", "music"]);

export function isValidSpace(slug) {
  return SPACES.has(slug);
}

export const DAY_MIN = 0;
export const DAY_MAX = 6;

export const START_MIN = 0;
export const START_MAX = 1439;

export const END_MIN = 1;
export const END_MAX = 2880;

export const SPACE_ID_MIN = 1;
export const SPACE_ID_MAX = 9;

export const ID_MIN = 1;
export const ID_MAX = Number.MAX_SAFE_INTEGER;
