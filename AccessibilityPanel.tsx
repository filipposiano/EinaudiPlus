// AccessibilityPanel.tsx — Pannello per personalizzare colori e icone degli stati.
//
// Si apre come bottom sheet modale (coerente con RulesModal, AdminSheet, ecc.)
// e permette di modificare:
//  • Colori per Libera / In uso / Fuori servizio (color picker + preset daltonismo)
//  • Icone per ciascuno stato (set predefinito: ✓ ✕ ! ● ▲ ■)
//
// Ogni modifica aggiorna in tempo reale:
//  1. L'anteprima (legenda esempio) nel pannello stesso
//  2. Le CSS custom properties (--status-*) → tutte le schermate si aggiornano via CSS

import { X, RotateCcw } from "lucide-react";
import {
  STATUS_KEYS,
  DEFAULT_PREFS,
  ICON_OPTIONS,
  COLORBLIND_PRESETS,
  type StatusKey,
  type AccessibilityPrefs,
} from "./statusConfig";

type Lang = "it" | "en";

const T = {
  it: {
    title: "Accessibilità",
    subtitle: "Personalizza la visualizzazione degli stati",
    colors: "Colori degli stati",
    icons: "Icone degli stati",
    preview: "Anteprima",
    presets: "Preset daltonismo",
    reset: "Ripristina default",
    free: "Libera",
    inuse: "In uso",
    oos: "Fuori servizio",
    freeDesc: "Disponibile per la prenotazione.",
    inuseDesc: "Turno in corso.",
    oosDesc: "Segnalata come guasta.",
    close: "Chiudi",
  },
  en: {
    title: "Accessibility",
    subtitle: "Customize status display",
    colors: "Status colors",
    icons: "Status icons",
    preview: "Preview",
    presets: "Colorblind presets",
    reset: "Reset to default",
    free: "Free",
    inuse: "In use",
    oos: "Out of service",
    freeDesc: "Available for booking.",
    inuseDesc: "Shift in progress.",
    oosDesc: "Reported as broken.",
    close: "Close",
  },
} as const;

const STATUS_LABELS: Record<Lang, Record<StatusKey, string>> = {
  it: { free: "Libera", inuse: "In uso", oos: "Fuori servizio" },
  en: { free: "Free", inuse: "In use", oos: "Out of service" },
};

const STATUS_DESCS: Record<Lang, Record<StatusKey, string>> = {
  it: { free: "Disponibile per la prenotazione.", inuse: "Turno in corso.", oos: "Segnalato come fuori servizio." },
  en: { free: "Available for booking.", inuse: "Shift in progress.", oos: "Reported as out of order." },
};


export default function AccessibilityPanel({ lang, prefs, onPrefsChange, onClose }: {
  lang: Lang;
  prefs: AccessibilityPrefs;
  onPrefsChange: (p: AccessibilityPrefs) => void;
  onClose: () => void;
}) {
  const t = T[lang];
  const fg   = "var(--foreground)";
  const sub  = "var(--muted-foreground)";
  const surf = "var(--card)";
  const div  = "var(--border)";
  const chip = "var(--secondary)";

  function setColor(key: StatusKey, color: string) {
    onPrefsChange({ ...prefs, colors: { ...prefs.colors, [key]: color } });
  }

  function setIcon(key: StatusKey, icon: string) {
    onPrefsChange({ ...prefs, icons: { ...prefs.icons, [key]: icon } });
  }

  function applyPreset(presetColors: Record<StatusKey, string>) {
    onPrefsChange({ ...prefs, colors: { ...presetColors } });
  }

  function resetAll() {
    onPrefsChange({ ...DEFAULT_PREFS, colors: { ...DEFAULT_PREFS.colors }, icons: { ...DEFAULT_PREFS.icons } });
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background: "rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div
        className="w-full rounded-t-3xl pb-8 max-h-[90%] overflow-y-auto"
        style={{ background: "var(--background)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky */}
        <div className="px-6 pt-5 pb-4 sticky top-0 z-10" style={{ background: "var(--background)" }}>
          <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }} />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold" style={{ color: fg }}>{t.title}</p>
              <p className="text-xs" style={{ color: sub }}>{t.subtitle}</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl" style={{ color: sub, background: chip }}><X size={16} /></button>
          </div>
        </div>

        <div className="px-6 flex flex-col gap-5">

          {/* ─── Anteprima live ──────────────────────────────────────────── */}
          <section>
            <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color: sub }}>{t.preview}</p>
            <div className="rounded-2xl overflow-hidden border" style={{ background: surf, borderColor: div }}>
              {STATUS_KEYS.map((key, i) => (
                <div key={key} className="px-4 py-3" style={{ borderBottom: i < STATUS_KEYS.length - 1 ? `1px solid ${div}` : "none" }}>
                  <div className="flex items-center gap-2 mb-1">
                    {prefs.icons[key] !== "●"
                      ? <span className="shrink-0 text-[13px] leading-none" style={{ color: prefs.colors[key] }}>{prefs.icons[key]}</span>
                      : <span className="size-2.5 rounded-full shrink-0" style={{ background: prefs.colors[key] }} />
                    }
                    <p className="text-xs font-semibold" style={{ color: fg }}>{STATUS_LABELS[lang][key]}</p>
                  </div>
                  <p className="text-xs" style={{ color: "color-mix(in srgb, var(--foreground) 50%, transparent)" }}>{STATUS_DESCS[lang][key]}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ─── Colori ────────────────────────────────────────────────── */}
          <section>
            <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color: sub }}>{t.colors}</p>
            <div className="rounded-2xl overflow-hidden border" style={{ background: surf, borderColor: div }}>
              {STATUS_KEYS.map((key, i) => (
                <div key={key} className="flex items-center gap-3 px-4 py-3"
                  style={{ borderBottom: i < STATUS_KEYS.length - 1 ? `1px solid ${div}` : "none" }}>
                  <label className="relative shrink-0 cursor-pointer">
                    <span className="block size-8 rounded-xl border" style={{ background: prefs.colors[key], borderColor: div }} />
                    <input
                      type="color"
                      value={prefs.colors[key]}
                      onChange={(e) => setColor(key, e.target.value)}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                  </label>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: fg }}>{STATUS_LABELS[lang][key]}</p>
                    <p className="text-[11px] font-mono" style={{ color: sub }}>{prefs.colors[key]}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ─── Preset daltonismo ──────────────────────────────────────── */}
          <section>
            <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color: sub }}>{t.presets}</p>
            <div className="flex flex-col gap-2">
              {Object.entries(COLORBLIND_PRESETS).map(([id, preset]) => (
                <button
                  key={id}
                  onClick={() => applyPreset(preset.colors)}
                  className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all active:scale-[0.98] border"
                  style={{ background: surf, borderColor: div }}
                >
                  {/* Mini anteprima colori */}
                  <div className="flex gap-1.5 shrink-0">
                    {STATUS_KEYS.map((k) => (
                      <span key={k} className="size-4 rounded-full" style={{ background: preset.colors[k] }} />
                    ))}
                  </div>
                  <span className="text-sm font-semibold" style={{ color: fg }}>{preset.label[lang]}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ─── Icone ──────────────────────────────────────────────────── */}
          <section>
            <p className="text-[11px] font-mono tracking-widest uppercase mb-2" style={{ color: sub }}>{t.icons}</p>
            <div className="rounded-2xl overflow-hidden border" style={{ background: surf, borderColor: div }}>
              {STATUS_KEYS.map((key, i) => (
                <div key={key} className="px-4 py-3"
                  style={{ borderBottom: i < STATUS_KEYS.length - 1 ? `1px solid ${div}` : "none" }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: fg }}>{STATUS_LABELS[lang][key]}</p>
                  <div className="flex gap-2">
                    {ICON_OPTIONS.map((icon) => {
                      const active = prefs.icons[key] === icon;
                      return (
                        <button
                          key={icon}
                          onClick={() => setIcon(key, icon)}
                          className="size-9 rounded-xl flex items-center justify-center text-base transition-all active:scale-90 border"
                          style={active
                            ? { background: prefs.colors[key], color: "#fff", borderColor: prefs.colors[key] }
                            : { background: chip, color: fg, borderColor: div }
                          }
                        >
                          {icon}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ─── Ripristina default ──────────────────────────────────────── */}
          <button
            onClick={resetAll}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-medium transition-all active:scale-[0.98] border"
            style={{ background: chip, color: sub, borderColor: div }}
          >
            <RotateCcw size={14} />
            {t.reset}
          </button>
        </div>
      </div>
    </div>
  );
}
