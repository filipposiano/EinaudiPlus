// statusConfig.ts — Configurazione centralizzata degli stati (Libero / In uso / Fuori uso).
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
// Scrive --status-free, --status-inuse, --status-oos direttamente su :root.
// Tutte le schermate che usano var(--status-*) si aggiornano in tempo reale.

export function applyToDOM(prefs: AccessibilityPrefs): void {
  const s = document.documentElement.style;
  s.setProperty("--status-free",  prefs.colors.free);
  s.setProperty("--status-inuse", prefs.colors.inuse);
  s.setProperty("--status-oos",   prefs.colors.oos);
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
