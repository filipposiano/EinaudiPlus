// Policy di autorizzazione del modulo Conference Room.
//
// La programmano solo gli amministratori (qualunque ruolo autenticato: FDO,
// staff, sistemista) — i residenti la leggono da un endpoint pubblico a sé
// (getAgenda), che di scrivere non sa proprio.

const AZIONI_CONFERENCE = new Set([
  "conferenzaList", "conferenzaAdd", "conferenzaUpdate", "conferenzaSkip",
  "conferenzaMove", "conferenzaResetOccorrenza", "conferenzaDelete",
]);

export function authorize(claims, action) {
  if (!AZIONI_CONFERENCE.has(action)) return null;
  return Boolean(claims);
}
