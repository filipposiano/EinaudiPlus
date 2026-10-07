// Emoji dei ticket della grigliata — condiviso fra il pannello del delegato
// (che la sceglie per ogni voce del menu) e la scheda residenti (che la
// mostra accanto al nome del ticket).

/** Le emoji proposte nell'editor del menu: un tocco invece di cercarle
 *  nella tastiera. Il delegato può comunque scriverne una qualsiasi. */
export const EMOJI_TICKET = [
  "🌭", "🍔", "🥩", "🍗", "🍖", "🥓", "🐟", "🍤", "🌽", "🥔", "🍟", "🥗",
  "🍅", "🧀", "🍞", "🥖", "🍕", "🍝", "🥙", "🌯", "🥪", "🍉", "🍰", "🍦",
  "🍺", "🍷", "🥤", "🧃", "💧", "☕", "🎟️",
];

/** Quando la voce non ne ha una: si mostra comunque un ticket, mai un buco. */
export const EMOJI_TICKET_DEFAULT = "🎟️";

// Parole (in minuscolo, senza accenti) → emoji. La prima che compare nel
// nome vince, quindi le più specifiche stanno prima ("hot dog" prima di
// "dog", "patatine" prima di "patat").
const SUGGERIMENTI: [string[], string][] = [
  [["hot dog", "hotdog", "wurstel", "würstel"], "🌭"],
  [["salsicc", "salamell", "luganeg"], "🌭"],
  [["hamburger", "burger", "panino con", "cheeseburger"], "🍔"],
  [["bistecc", "costin", "arrosticin", "spiedin", "carne", "manzo", "maiale", "tagliata", "grigliata"], "🥩"],
  [["pollo", "alett", "cosc"], "🍗"],
  [["bacon", "pancetta", "speck"], "🥓"],
  [["pesce", "salmone", "tonno", "orata", "branzino"], "🐟"],
  [["gamber", "scampi", "frittura"], "🍤"],
  [["pannocchi", "mais"], "🌽"],
  [["patatine", "fries", "chips"], "🍟"],
  [["patat"], "🥔"],
  [["insalat", "verdur", "contorno", "vegan", "vegetarian"], "🥗"],
  [["pomodor", "bruschett"], "🍅"],
  [["formagg", "scamorz", "provola", "mozzarell"], "🧀"],
  [["pane", "panino", "piadin"], "🥖"],
  [["pizza", "focacc"], "🍕"],
  [["pasta", "spaghett", "lasagn"], "🍝"],
  [["kebab", "gyro"], "🥙"],
  [["anguria", "cocomero", "frutta", "melone"], "🍉"],
  [["dolce", "torta", "dessert", "tiramis", "crostat"], "🍰"],
  [["gelato"], "🍦"],
  [["birra", "beer"], "🍺"],
  [["vino", "sangria", "spritz"], "🍷"],
  [["succo"], "🧃"],
  [["acqua", "water"], "💧"],
  [["caffe", "coffee"], "☕"],
  [["bibita", "bevanda", "drink", "coca", "fanta", "sprite", "aranciata", "lattina"], "🥤"],
];

/** L'emoji che si propone per un nome di ticket ("Salsiccia" → 🌭), o null
 *  se nessuna parola nota compare nel nome. */
export function suggerisciEmoji(nome: string): string | null {
  const n = nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [parole, emoji] of SUGGERIMENTI) {
    if (parole.some(p => n.includes(p.normalize("NFD").replace(/[̀-ͯ]/g, "")))) return emoji;
  }
  return null;
}
