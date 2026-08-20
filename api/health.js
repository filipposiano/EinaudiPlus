// Diagnostica di configurazione.
//
// Esiste perche' quando il deploy risponde 500 su tutto, da fuori non si
// distingue "variabile mancante" da "variabile con il valore sbagliato", e i
// log di Vercel non sono accessibili a chi non ha l'account.
//
// Non stampa MAI il valore di un segreto: solo se c'e', quanto e' lungo e con
// quale prefisso comincia — che e' esattamente cio' che serve per accorgersi di
// aver incollato la chiave sbagliata.
//
// Protetto dal segreto del cron: le informazioni sono poche, ma dire a chiunque
// quali variabili sono configurate e' comunque un regalo a chi sonda.

import { json, methodOk } from "./_lib/http.js";

/** Descrive una variabile senza rivelarla. */
function peek(name, { secret = true, prefix = 0 } = {}) {
  const v = process.env[name];
  if (!v) return { nome: name, presente: false };

  const out = { nome: name, presente: true, lunghezza: v.length };

  // Spazi o a capo incollati per sbaglio: causa frequente e invisibile a occhio.
  if (v !== v.trim()) out.attenzione = "ha spazi o a capo attorno";

  if (!secret) out.valore = v;
  else if (prefix) out.inizia_per = v.slice(0, prefix);

  return out;
}

export default async function handler(req, res) {
  if (!methodOk(req, res, ["GET", "POST"])) return;

  if (!process.env.CRON_SECRET || req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return json(res, 401, { ok: false, error: "unauthorized" });
  }

  const variabili = [
    peek("SUPABASE_URL", { secret: false }),
    peek("SUPABASE_SECRET_KEY", { prefix: 12 }),   // sb_secret_ vs sb_publishable_ vs eyJ… (legacy)
    peek("APP_TOKEN", { prefix: 4 }),
    peek("CRON_SECRET", { prefix: 4 }),
    peek("ADMIN_USER", { secret: false }),
    peek("ADMIN_PASSWORD_HASH", { prefix: 7 }),    // deve iniziare per "scrypt$"
    peek("ADMIN_SESSION_SECRET", { prefix: 4 }),
    peek("SYSADMIN_USER", { secret: false }),
    peek("SYSADMIN_PASSWORD_HASH", { prefix: 7 }),
    peek("VAPID_PUBLIC_KEY", { prefix: 8 }),
    peek("VAPID_PRIVATE_KEY", { prefix: 4 }),
    peek("VAPID_SUBJECT", { secret: false }),
    peek("TELEGRAM_BOT_TOKEN", { prefix: 10 }),
    peek("TELEGRAM_WEBHOOK_SECRET", { prefix: 4 }),
  ];

  // Prova di raggiungibilita' del database, con l'errore vero di PostgREST:
  // e' quello che dice se la chiave e' sbagliata o se l'URL non risponde.
  let database;
  const t0 = Date.now();
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    if (!url || !key) {
      database = { ok: false, causa: "SUPABASE_URL o SUPABASE_SECRET_KEY non impostate" };
    } else {
      const r = await fetch(`${url}/rest/v1/rpc/current_week_start`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const body = (await r.text()).slice(0, 300);
      database = { ok: r.ok, http: r.status, risposta: body, ms: Date.now() - t0 };
    }
  } catch (err) {
    database = { ok: false, causa: "rete: " + err.message, ms: Date.now() - t0 };
  }

  return json(res, 200, { ok: true, variabili, database });
}
