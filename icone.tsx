// icone.tsx — le icone disegnate a mano, quelle che lucide non ha.
//
// Stava dentro App.tsx, dove serviva solo a lui. Da quando le prenotazioni
// hanno una schermata propria (MiePrenotazioni.tsx) la lavatrice la disegnano
// in due, e due copie dello stesso SVG sono due copie che prima o poi
// divergono.

/** L'oblò con il cestello: la lavatrice, ovunque compaia nell'app. */
export function WashingMachine({ size = 16, style, className }: {
  size?: number; style?: React.CSSProperties; className?: string;
}) {
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
