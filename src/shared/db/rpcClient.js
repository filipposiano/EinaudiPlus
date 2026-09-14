// Accesso al database via PostgREST — invariato rispetto a api/_lib/db.js
// originale, solo spostato nel kernel condiviso e con gli errori tipizzati.
//
// La chiave usata è la Secret key: bypassa la RLS, non deve mai raggiungere
// il browser. Sta solo nelle env var server (vedi shared/config/env.js).

import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

export function dbConfigured() {
  return Boolean(env.supabaseUrl && env.supabaseSecretKey);
}

export async function rpc(fn, args = {}) {
  if (!dbConfigured()) {
    throw new AppError("database non configurato", { status: 500, code: "db_not_configured" });
  }

  const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.supabaseSecretKey,
      Authorization: `Bearer ${env.supabaseSecretKey}`,
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
    } catch { /* raw va bene così */ }
    const err = new AppError(detail, { status: res.status, code: "rpc_error" });
    err.rpc = fn;
    throw err;
  }

  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

/** Come rpc(), ma non solleva: le letture non devono far cadere la pagina. */
export async function rpcSafe(fn, args = {}) {
  try {
    return await rpc(fn, args);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
