// Limiti della griglia lavanderia.
//
// I numeri veri (quanti turni ha davvero una lavanderia, quante lavatrici)
// vivono in tabella e li ricontrolla il database a ogni chiamata (vedi
// laundry.n_slots e la migrazione 004-oltre-mezzanotte, che ha permesso a
// sei dei diciannove turni di scavalcare la mezzanotte). Queste costanti sono
// solo un limite superiore per scartare l'assurdo prima di un giro di rete —
// non sostituiscono la validazione SQL, la anticipano.

export const DAY_MIN = 0;
export const DAY_MAX = 6;

export const SLOT_MIN = 0;
export const SLOT_MAX = 18; // 19 turni al giorno (0..18)

export const LAUNDRY_ID_MIN = 1;
export const LAUNDRY_ID_MAX = 9;

export const OFFSET_MIN = -52;
export const OFFSET_MAX = 52;

export const ID_MIN = 1;
export const ID_MAX = Number.MAX_SAFE_INTEGER;
