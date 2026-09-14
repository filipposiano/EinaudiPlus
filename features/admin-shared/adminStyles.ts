// Stili condivisi da ogni scheda del pannello amministrativo.

export const S = {
  page: { minHeight: "100vh", background: "var(--background)", color: "var(--foreground)" } as const,
  card: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16 } as const,
  sub: { color: "var(--gray-accessible-text)" } as const,
  btn: {
    padding: "8px 14px", borderRadius: 12, fontSize: 13, fontWeight: 600,
    border: "1px solid var(--border)", background: "var(--secondary)",
    color: "var(--foreground)", cursor: "pointer",
  } as const,
  danger: {
    padding: "6px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer",
    border: "none", background: "color-mix(in srgb, var(--destructive) 12%, transparent)",
    color: "var(--destructive-text)",
  } as const,
  input: {
    padding: "10px 12px", borderRadius: 12, fontSize: 14, width: "100%",
    border: "1px solid var(--border)", background: "var(--background)",
    color: "var(--foreground)",
  } as const,
};
