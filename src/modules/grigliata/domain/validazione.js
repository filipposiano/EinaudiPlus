// Regole di forma del modulo Grigliata — validazioni PRIMA di spendere una
// chiamata di rete, stesso principio di linen-change/domain/schedule.js. La
// verità finale resta comunque nelle funzioni SQL (grigliata_iscrivi,
// grigliata_admin_crea, grigliata_menu_errore), che rifiutano da sole se
// questo controllo venisse aggirato chiamando l'RPC direttamente.

/** Stesso tetto del vincolo `check` sulla colonna `note` in SQL. */
export const NOTE_MAX = 300;

// v1.3: i menu non sono più un elenco fisso — li decide il delegato per ogni
// grigliata (vedi grigliata_menu in SQL). Il PRIMO è quello "di base": nel
// pannello non viene segnato sulle pastiglie, si segnano solo i casi diversi.
export const MENU_MAX = 10;
export const MENU_NOME_MAX = 40;

// v1.5: ogni menu si scompone in una o più voci-ticket (es. menu "Carne" =
// "Salsiccia" + "Patatine" + "Bibita"), decise dal delegato insieme al menu
// stesso — un'adesione riceve, alla conferma del pagamento, un ticket vero
// per ciascuna (vedi grigliata_admin_conferma_pagamento in SQL). Stessi
// tetti del menu, un livello più in basso.
export const TICKET_MAX = 10;
export const TICKET_NOME_MAX = 40;

/**
 * Ripulisce e controlla l'elenco delle voci-ticket di UN menu: un array di
 * `{ id?, nome }`, stesse regole di controllaMenu() un livello più in
 * basso — stesse regole di grigliata_ticket_errore().
 */
export function controllaTicket(lista) {
  if (!Array.isArray(lista)) return { errore: "elenco ticket non valido" };
  if (lista.length < 1) return { errore: "serve almeno un ticket per menu" };
  if (lista.length > TICKET_MAX) return { errore: `al massimo ${TICKET_MAX} ticket per menu` };

  const visti = new Set();
  const ids = new Set();
  const ticket = [];
  for (const voce of lista) {
    const nome = String(voce?.nome ?? "").trim();
    if (!nome) return { errore: "ogni ticket deve avere un nome" };
    if (nome.length > TICKET_NOME_MAX) return { errore: `nome del ticket troppo lungo (massimo ${TICKET_NOME_MAX} caratteri)` };
    const chiave = nome.toLowerCase();
    if (visti.has(chiave)) return { errore: `due ticket con lo stesso nome: ${nome}` };
    visti.add(chiave);

    const id = idValido(voce?.id);
    if (id) {
      if (ids.has(id)) return { errore: "ticket non valido" };
      ids.add(id);
      ticket.push({ id, nome });
    } else {
      ticket.push({ nome });
    }
  }
  return { ticket };
}

/**
 * Ripulisce e controlla l'elenco dei menu scritto dal delegato: un array di
 * `{ id?, nome, ticket }` nell'ordine voluto (`id` presente solo per un menu
 * che esiste già e si sta rinominando). Torna `{ menu }` ripulito, o
 * `{ errore }` con il messaggio da mostrare — stesse regole di
 * grigliata_menu_errore().
 */
export function controllaMenu(lista) {
  if (!Array.isArray(lista)) return { errore: "menu non valido" };
  if (lista.length < 1) return { errore: "serve almeno un menu" };
  if (lista.length > MENU_MAX) return { errore: `al massimo ${MENU_MAX} menu` };

  const visti = new Set();
  const ids = new Set();
  const menu = [];
  for (const voce of lista) {
    const nome = String(voce?.nome ?? "").trim();
    if (!nome) return { errore: "ogni menu deve avere un nome" };
    if (nome.length > MENU_NOME_MAX) return { errore: `nome del menu troppo lungo (massimo ${MENU_NOME_MAX} caratteri)` };
    const chiave = nome.toLowerCase();
    if (visti.has(chiave)) return { errore: `due menu con lo stesso nome: ${nome}` };
    visti.add(chiave);

    const esitoTicket = controllaTicket(voce?.ticket);
    if (esitoTicket.errore) return { errore: `menu "${nome}": ${esitoTicket.errore}` };

    const id = idValido(voce?.id);
    if (id) {
      // Lo stesso menu esistente elencato due volte: uno dei due nomi
      // sparirebbe in silenzio.
      if (ids.has(id)) return { errore: "menu non valido" };
      ids.add(id);
      menu.push({ id, nome, ticket: esitoTicket.ticket });
    } else {
      menu.push({ nome, ticket: esitoTicket.ticket });
    }
  }
  return { menu };
}

/** Un id di menu (o di evento/adesione): intero positivo. */
export function idValido(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// v1.3.1: "vegetariano"/"vegano" NON sono menu — sono un'informazione a sé
// che il residente dichiara IN PIÙ, qualunque menu (fra quelli configurati
// dal delegato, es. "Carne"/"Pesce") abbia scelto: si può benissimo
// scegliere "Carne" e dichiararsi vegani (il delegato prepara qualcosa a
// parte). Stessa idea di "senza glutine", solo con tre stati invece di due.
export const DIETA_VALORI = ["classico", "vegetariano", "vegano"];

/** Un valore mancante o non riconosciuto ricade su "classico" (mangia di
 *  tutto): non è un errore bloccante, è l'informazione di default — stessa
 *  scelta già fatta per "senza glutine" in iscriviti.js. */
export function dietaValida(v) {
  return DIETA_VALORI.includes(v) ? v : "classico";
}

/**
 * `v` è una data/ora valida? Vale sia per la scadenza delle iscrizioni (un
 * `<input type="datetime-local">`, "2026-10-03T18:30") sia per il giorno
 * della grigliata (`<input type="date">`, "2026-10-03"). Nessuna delle due
 * deve essere nel futuro: dalla v1.6 la scadenza delle iscrizioni può essere
 * già passata (la scheda resta visibile fino al giorno dopo la grigliata, non
 * fino alla scadenza — vedi grigliata_visibile in SQL); l'evento potrebbe
 * anche cadere lo stesso giorno in cui chiudono le iscrizioni.
 */
export function isValidDate(v) {
  return Number.isFinite(Date.parse(String(v || "")));
}

// v1.4.1: la quota a persona. Stesso tetto del vincolo `check` in SQL.
export const QUOTA_MAX = 1000;

/**
 * Interpreta la quota scritta dal delegato: numero o stringa, con la
 * virgola italiana ("12,50") o il punto. Vuota/assente = nessuna quota
 * (`{ quota: null }`). Torna `{ quota }` arrotondata ai centesimi, o
 * `{ errore }`.
 */
export function controllaQuota(v) {
  if (v === null || v === undefined || String(v).trim() === "") return { quota: null };
  const testo = String(v).trim().replace(/\s*€\s*/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(testo)) return { errore: "quota non valida" };
  const n = Number(testo);
  if (n > QUOTA_MAX) return { errore: `quota non valida (massimo ${QUOTA_MAX} €)` };
  return { quota: Math.round(n * 100) / 100 };
}
