// Confronto di segreti a tempo costante.
//
// Il `===` fra stringhe in JavaScript procede byte per byte e si ferma al
// primo diverso: confrontare "AAAA…" con il segreto vero e' leggermente piu'
// veloce che confrontare "XAAA…" se il segreto inizia per X. Misurando i tempi
// su moltissimi tentativi si ricostruisce il segreto un carattere alla volta —
// da una ricerca impossibile a una lineare.
//
// Su HTTP, da remoto, non e' sfruttabile: la differenza e' nell'ordine dei
// nanosecondi, mentre il rumore di rete sta nei millisecondi, sei ordini di
// grandezza sopra. Questo file esiste lo stesso per coerenza: identity/
// confronta gia' cosi' le password e la firma dei token di sessione, e avere
// altrove lo stesso gesto fatto alla maniera ingenua e' l'incoerenza che un
// domani qualcuno ricopia in un punto dove invece conta.
//
// Si passa dall'hash invece di confrontare i byte grezzi apposta: porta i due
// lati a 32 byte fissi, cosi' non serve un ramo sulla lunghezza (che a sua
// volta la rivelerebbe) e timingSafeEqual non puo' sollevare per lunghezze
// diverse.

import crypto from "node:crypto";

const impronta = (v) => crypto.createHash("sha256").update(String(v), "utf8").digest();

/**
 * @param {unknown} atteso il valore configurato sul server
 * @param {unknown} ricevuto il valore arrivato dal client
 * @returns {boolean} true solo se sono entrambi stringhe non vuote e coincidono
 *
 * Un segreto non configurato (null, undefined, stringa vuota) non fa MAI
 * passare: se cosi' non fosse, dimenticare la variabile d'ambiente aprirebbe
 * l'endpoint a chiunque invece di chiuderlo.
 */
export function segretiCoincidono(atteso, ricevuto) {
  if (typeof atteso !== "string" || !atteso) return false;
  if (typeof ricevuto !== "string" || !ricevuto) return false;
  return crypto.timingSafeEqual(impronta(atteso), impronta(ricevuto));
}
