// Accesso al database via PostgREST.
//
// Niente @supabase/supabase-js: tutte le mutazioni passano da funzioni SQL, quindi
// serve solo saper chiamare /rest/v1/rpc/. Una fetch fa lo stesso lavoro senza
// aggiungere una dipendenza che peserebbe sul cold start di ogni funzione.
//
// La chiave usata e' la Secret key (sb_secret_...): bypassa la RLS, quindi non
// deve MAI raggiungere il browser. Sta solo nelle env var server di Vercel.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

export function dbConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);
}

/**
 * Invoca una funzione SQL e ne restituisce il valore di ritorno.
 * Le nostre funzioni tornano gia' jsonb nella forma attesa dal client,
 * quindi qui non si rimappa nulla: un solo posto dove il contratto vive.
 */
export async function rpc(fn, args = {}) {
  if (!dbConfigured()) {
    throw new Error("database non configurato");
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  const raw = await res.text();

  if (!res.ok) {
    let detail = raw;
    try {
      const parsed = JSON.parse(raw);
      detail = parsed.message || parsed.hint || raw;
    } catch {
      /* raw va bene cosi' */
    }
    const err = new Error(detail);
    err.status = res.status;
    err.rpc = fn;
    throw err;
  }

  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Come rpc(), ma non solleva: le letture non devono far cadere la pagina. */
export async function rpcSafe(fn, args = {}) {
  try {
    return await rpc(fn, args);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
