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

/**
 * Ripulisce e controlla l'elenco dei menu scritto dal delegato: un array di
 * `{ id?, nome }` nell'ordine voluto (`id` presente solo per un menu che
 * esiste già e si sta rinominando). Torna `{ menu }` ripulito, o `{ errore }`
 * con il messaggio da mostrare — stesse regole di grigliata_menu_errore().
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

    const id = idValido(voce?.id);
    if (id) {
      // Lo stesso menu esistente elencato due volte: uno dei due nomi
      // sparirebbe in silenzio.
      if (ids.has(id)) return { errore: "menu non valido" };
      ids.add(id);
      menu.push({ id, nome });
    } else {
      menu.push({ nome });
    }
  }
  return { menu };
}

/** Un id di menu (o di evento/adesione): intero positivo. */
export function idValido(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * `v` è una data/ora nel futuro? Accetta qualunque stringa che `Date` sappia
 * interpretare (l'input del form è un `<input type="datetime-local">`, che
 * produce "2026-10-03T18:30").
 */
export function isFutureDateTime(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) && t > Date.now();
}
