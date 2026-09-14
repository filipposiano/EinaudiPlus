// Valvola in memoria, davanti al rate limit su Postgres.
//
// Il problema che risolve: checkRateLimit() conta le richieste con una RPC su
// Supabase, cioe' una scrittura sul database. Fin qui va bene — ma vuol dire
// che sotto alluvione il limite AMPLIFICA invece di proteggere: ogni richiesta
// rifiutata costa comunque un'invocazione serverless piu' una scrittura, ed e'
// il database (la risorsa piu' scarsa e piu' lenta del giro) a pagarla. Chi
// inonda ottiene il suo effetto proprio attraverso la difesa.
//
// Questa valvola sta davanti e non parla con nessuno: un contatore in RAM
// nell'istanza serverless gia' calda. Quando scatta, la richiesta muore prima
// di toccare la rete.
//
// ── Cosa NON e' ──────────────────────────────────────────────────────────────
// Non e' il limite di policy, e non lo sostituisce. Il conteggio e' PER
// ISTANZA: Vercel ne tiene accese N in parallelo e non condividono niente, per
// cui il tetto vero visto da fuori e' N volte quello qui sotto, e N non e'
// prevedibile. Solo Postgres puo' dire "cinque tentativi di login in tutto".
//
// E' una valvola di sicurezza contro un rubinetto aperto, tarata talmente
// larga da non poter mai riguardare traffico umano — vedi TETTO_PREDEFINITO.

const FINESTRA_MS = 10_000;

// Oltre questo numero di chiavi si pota. Serve perche' la mappa stessa non
// diventi il bersaglio: chi ruota l'indirizzo a ogni richiesta farebbe crescere
// la memoria dell'istanza finche' non muore, trasformando la difesa nel guasto.
const TETTO_CHIAVI = 5_000;

// Sessanta richieste in dieci secondi dallo STESSO indirizzo verso la STESSA
// istanza. Nessuna persona ci arriva: un telefono che ricarica la dashboard fa
// una richiesta, non sei al secondo.
//
// Il margine e' largo di proposito, e il motivo e' il NAT. In collegio le
// camere stanno dietro alla rete di casa: da fuori centinaia di residenti
// hanno lo stesso indirizzo pubblico, quindi sono un client solo agli occhi di
// qualunque limite per IP. A fine turno Dashboard.tsx fa reload() su tutti i
// dispositivi aperti nello stesso istante, e quella e' l'ondata legittima piu'
// alta che l'app produce: deve passare senza nemmeno sfiorare la valvola.
const TETTO_PREDEFINITO = 60;

/** @type {Map<string, { inizio: number, colpi: number }>} */
const finestre = new Map();

function pota(ora) {
  for (const [chiave, f] of finestre) {
    if (ora - f.inizio >= FINESTRA_MS) finestre.delete(chiave);
  }
  // Se erano tutte fresche la potatura non ha liberato niente: si svuota e si
  // riparte. Dimenticare i conteggi e' la scelta giusta rispetto al crescere
  // senza fine — la valvola e' un'euristica, il limite vero resta su Postgres.
  if (finestre.size >= TETTO_CHIAVI) finestre.clear();
}

/**
 * @param {string} chiave gia' composta come "bucket:identificatore"
 * @param {number} [tetto] richieste ammesse nella finestra, per istanza
 * @param {number} [ora] iniettabile per i test, mai passato in produzione
 * @returns {boolean} true = passa oltre (e si va a interrogare Postgres)
 */
export function throttleLocale(chiave, tetto = TETTO_PREDEFINITO, ora = Date.now()) {
  const f = finestre.get(chiave);

  if (!f || ora - f.inizio >= FINESTRA_MS) {
    if (finestre.size >= TETTO_CHIAVI) pota(ora);
    finestre.set(chiave, { inizio: ora, colpi: 1 });
    return true;
  }

  f.colpi += 1;
  return f.colpi <= tetto;
}

/** Solo per i test: azzera lo stato fra un caso e l'altro. */
export function _azzeraThrottleLocale() {
  finestre.clear();
}

/** Solo per i test: quante chiavi sono in memoria adesso. */
export function _dimensioneMappa() {
  return finestre.size;
}

export const _FINESTRA_MS = FINESTRA_MS;
export const _TETTO_CHIAVI = TETTO_CHIAVI;
export const _TETTO_PREDEFINITO = TETTO_PREDEFINITO;
