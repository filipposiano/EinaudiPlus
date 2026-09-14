// Icone condivise fra la shell (LoginScreen, DesktopSidebar) e le feature
// (Laundry): non appartengono a una sola, vivono qui.

export function WashingMachine({ size = 16, style, className }: { size?: number; style?: React.CSSProperties; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={style} className={className} aria-hidden="true">
      <rect width="18" height="20" x="3" y="2" rx="2" />
      <path d="M3 6h18" />
      <path d="M7 4h.01" />
      <path d="M10.5 4h.01" />
      <circle cx="12" cy="14" r="5" />
      <path d="M12 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 1 0-5" />
    </svg>
  );
}
