// tema.ts — i colori dell'app, come nomi invece che come stringhe sparse.
//
// Sono tutti riferimenti a variabili CSS: i valori veri stanno in style.css, che
// è anche il posto dove leggere PERCHÉ sono quelli. Qui c'è solo il vocabolario.

export type Theme = "dark" | "light";

export const RED    = "var(--primary)";
export const RED_FG = "var(--primary-foreground)";

// I colori di stato hanno DUE livelli, e la coppia va scelta in base a cosa
// dipinge — non è una preferenza estetica, cambia la leggibilità:
//
//   GREEN / YELLOW / OOS_C / ORANGE
//     la tinta vivace, identica a quella dichiarata nel pannello
//     Accessibilità. Per riempimenti, pastiglie, bordi, pallini, blocchi
//     della griglia: superfici colorate, dove il vivace si vede benissimo.
//
//   GREEN_T / YELLOW_T / OOS_T / ORANGE_T
//     la stessa famiglia scurita fino a reggere il 4,5:1 del WCAG AA sul
//     bianco. Per il TESTO e per le icone che da sole vogliono dire qualcosa.
//
// Usare le "-T" anche sui riempimenti è l'errore da non rifare: le pastiglie
// passano da `color-mix(verde 15%)` a un verdolino sporco, che è esattamente
// l'effetto che si era chiesto di togliere.
export const YELLOW = "var(--status-inuse)";
export const ORANGE = "var(--status-prev)";
export const OOS_C  = "var(--status-oos)";
export const GREEN  = "var(--status-free)";

export const YELLOW_T = "var(--status-inuse-text)";
export const ORANGE_T = "var(--status-prev-text)";
export const OOS_T    = "var(--status-oos-text)";
export const GREEN_T  = "var(--status-free-text)";

// Le tinte neutre, usate ovunque con questi stessi nomi.
export const FG   = "var(--foreground)";
export const SUB  = "var(--gray-accessible-text)";
export const DIV  = "var(--border)";
export const SURF = "var(--card)";
export const CHIP = "var(--secondary)";
export const BG   = "var(--background)";
