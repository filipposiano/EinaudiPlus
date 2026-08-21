// statusConfig.ts — Configurazione centralizzata degli stati (Libera / In uso / Fuori servizio).
//
// Unico punto di verità per colori, icone, preset daltonismo, persistenza
// e applicazione via CSS custom properties.

// ─── Tipi ──────────────────────────────────────────────────────────────────────

export const STATUS_KEYS = ["free", "inuse", "oos"] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

export interface AccessibilityPrefs {
  colors: Record<StatusKey, string>;
  icons: Record<StatusKey, string>;
}

// ─── Default ───────────────────────────────────────────────────────────────────

export const DEFAULT_COLORS: Record<StatusKey, string> = {
  free:  "#22c55e",
  inuse: "#eab308",
  oos:   "#ff4757",
};

export const DEFAULT_ICONS: Record<StatusKey, string> = {
  free:  "●",
  inuse: "●",
  oos:   "●",
};

export const DEFAULT_PREFS: AccessibilityPrefs = {
  colors: { ...DEFAULT_COLORS },
  icons:  { ...DEFAULT_ICONS },
};

// ─── Set icone selezionabili ───────────────────────────────────────────────────

export const ICON_OPTIONS = ["✓", "✕", "!", "●", "▲", "■"] as const;

// ─── Preset daltonismo ─────────────────────────────────────────────────────────

export const COLORBLIND_PRESETS: Record<string, { label: { it: string; en: string }; colors: Record<StatusKey, string> }> = {
  protanopia: {
    label: { it: "Protanopia", en: "Protanopia" },
    colors: { free: "#56B4E9", inuse: "#E69F00", oos: "#CC79A7" },
  },
  deuteranopia: {
    label: { it: "Deuteranopia", en: "Deuteranopia" },
    colors: { free: "#56B4E9", inuse: "#F0E442", oos: "#D55E00" },
  },
  tritanopia: {
    label: { it: "Tritanopia", en: "Tritanopia" },
    colors: { free: "#009E73", inuse: "#CC79A7", oos: "#D55E00" },
  },
};

// ─── Persistenza ───────────────────────────────────────────────────────────────

const LS_KEY = "einaudiplus.accessibility";

export function loadPrefs(): AccessibilityPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { colors: { ...DEFAULT_COLORS }, icons: { ...DEFAULT_ICONS } };
    const parsed = JSON.parse(raw);
    return {
      colors: {
        free:  parsed?.colors?.free  ?? DEFAULT_COLORS.free,
        inuse: parsed?.colors?.inuse ?? DEFAULT_COLORS.inuse,
        oos:   parsed?.colors?.oos   ?? DEFAULT_COLORS.oos,
      },
      icons: {
        free:  parsed?.icons?.free  ?? DEFAULT_ICONS.free,
        inuse: parsed?.icons?.inuse ?? DEFAULT_ICONS.inuse,
        oos:   parsed?.icons?.oos   ?? DEFAULT_ICONS.oos,
      },
    };
  } catch {
    return { colors: { ...DEFAULT_COLORS }, icons: { ...DEFAULT_ICONS } };
  }
}

export function savePrefs(prefs: AccessibilityPrefs): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch {}
}

// ─── Applicazione via CSS Custom Properties ────────────────────────────────────
//
// style.css definisce due livelli per ogni stato:
//   --status-KEY       la palette dichiarata qui sopra (DEFAULT_COLORS),
//                       identica in entrambi i temi — quella che questo
//                       pannello mostra e che l'utente personalizza.
//   --status-KEY-text  il livello con cui l'app rende testo e icone. Oggi è
//                       un semplice alias del primo: era una variante più
//                       scura per il contrasto WCAG, ed è tornato ai colori
//                       originali su richiesta.
//
// Quando l'utente NON ha personalizzato nulla, non si scrive niente qui: è il
// foglio di stile a decidere entrambi i livelli, ognuno per il proprio tema.
// Quando personalizza (color picker o preset daltonismo), il valore scelto si
// scrive su ENTRAMBI i livelli — necessario finché l'alias esiste, perché
// scrivere solo la base lascerebbe il livello "testo" fermo al vecchio colore
// in tutta l'app tranne che nell'anteprima di questo pannello.
export function applyToDOM(prefs: AccessibilityPrefs): void {
  const s = document.documentElement.style;

  const apply = (base: string, value: string, fallback: string) => {
    if (value === fallback) {
      s.removeProperty(base);
      s.removeProperty(`${base}-text`);
    } else {
      s.setProperty(base, value);
      s.setProperty(`${base}-text`, value);
    }
  };

  apply("--status-free",  prefs.colors.free,  DEFAULT_COLORS.free);
  apply("--status-inuse", prefs.colors.inuse, DEFAULT_COLORS.inuse);
  apply("--status-oos",   prefs.colors.oos,   DEFAULT_COLORS.oos);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Restituisce l'icona configurata per un dato stato. */
export function iconFor(status: StatusKey, prefs: AccessibilityPrefs): string {
  return prefs.icons[status];
}

/** true se almeno un'impostazione differisce dal default. */
export function isCustomized(prefs: AccessibilityPrefs): boolean {
  return (
    prefs.colors.free  !== DEFAULT_COLORS.free  ||
    prefs.colors.inuse !== DEFAULT_COLORS.inuse ||
    prefs.colors.oos   !== DEFAULT_COLORS.oos   ||
    prefs.icons.free   !== DEFAULT_ICONS.free   ||
    prefs.icons.inuse  !== DEFAULT_ICONS.inuse  ||
    prefs.icons.oos    !== DEFAULT_ICONS.oos
  );
}
