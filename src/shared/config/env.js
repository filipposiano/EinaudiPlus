// Punto unico di lettura delle variabili d'ambiente.
//
// Oggi ogni modulo controlla da solo `Boolean(process.env.X)` (dbConfigured(),
// adminConfigured(), pushConfigured(), telegramConfigured() in _lib/*.js):
// stessa idea ripetuta in quattro punti diversi, con quattro nomi diversi.
// Qui vive una volta sola, e resta la lettura lazy di process.env (niente
// crash all'avvio del processo se una var manca: alcune sono opzionali per
// design — es. ADMIN_SESSION_SECRET assente in un ambiente di solo test).

export const env = {
  get supabaseUrl() { return process.env.SUPABASE_URL || null; },
  get supabaseSecretKey() { return process.env.SUPABASE_SECRET_KEY || null; },
  get adminSessionSecret() { return process.env.ADMIN_SESSION_SECRET || null; },
  get appToken() { return process.env.APP_TOKEN || null; },
  get cronSecret() { return process.env.CRON_SECRET || null; },
};

export function isConfigured(...keys) {
  return keys.every((k) => Boolean(env[k]));
}
