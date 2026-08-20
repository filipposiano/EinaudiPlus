// Tick dei promemoria, invocato da pg_cron dentro Supabase (una volta al minuto).
//
// Perche' non Vercel Cron: il piano Hobby limita i cron a UNA volta al giorno.
// pg_cron gira nel database, ha granularita' al minuto ed e' incluso nel free tier.
//
// Qui non c'e' logica di scheduling: "chi va avvisato adesso" lo decide
// claim_due_reminders() in SQL. Questa funzione firma e spedisce, nient'altro.

import { rpc } from "./_lib/db.js";
import { sendWebPush, pushConfigured } from "./_lib/push.js";
import { json, methodOk } from "./_lib/http.js";

const TELEGRAM_API = "https://api.telegram.org";

async function sendTelegram(chatId, title, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return "err";
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `*${title}*\n${body}`,
        parse_mode: "Markdown",
      }),
    });
    return res.ok ? "ok" : "err";
  } catch {
    return "err";
  }
}

export default async function handler(req, res) {
  if (!methodOk(req, res, ["POST", "GET"])) return;

  // Il segreto viaggia in header, non in query: le query string finiscono nei
  // log di accesso, gli header no.
  const secret = req.headers["x-cron-secret"];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return json(res, 401, { ok: false, error: "unauthorized" });
  }

  const started = Date.now();

  try {
    // Rivendica e spedisce in un colpo solo: le righe tornate sono gia'
    // marcate come inviate, quindi un tick sovrapposto non le rivedra'.
    const due = await rpc("claim_due_reminders", { p_grace_min: 10 });
    const rows = Array.isArray(due) ? due : [];

    const gone = new Set();
    const stats = new Map(); // "bookingId:kind" -> {ok, fail}

    const bump = (r, field) => {
      const k = `${r.booking_id}:${r.kind}`;
      const s = stats.get(k) || { booking_id: r.booking_id, kind: r.kind, ok: 0, fail: 0 };
      s[field]++;
      stats.set(k, s);
    };

    if (rows.length && pushConfigured()) {
      // In parallelo: sono richieste indipendenti verso servizi esterni, e il
      // tempo di esecuzione di una funzione serverless e' limitato.
      await Promise.all(
        rows.map(async (r) => {
          if (r.endpoint) {
            const outcome = await sendWebPush(
              { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
              { title: r.title, body: r.body, url: "/", tag: r.tag, kind: r.kind }
            );
            if (outcome === "gone") gone.add(r.endpoint);
            bump(r, outcome === "ok" ? "ok" : "fail");
          }

          if (r.chat_id) {
            const t = await sendTelegram(r.chat_id, r.title, r.body);
            bump(r, t === "ok" ? "ok" : "fail");
          }
        })
      );
    }

    await rpc("report_reminder_results", {
      p_gone: [...gone],
      p_stats: [...stats.values()],
    });

    // Doppio scopo. Uno: pulizia periodica di net._http_response, che pg_net
    // riempie a ogni chiamata e che nessuno svuota da solo.
    // Due: i progetti Supabase gratuiti vanno in pausa dopo 7 giorni di
    // inattivita', misurata sulle richieste API. Il cron interno potrebbe non
    // contare: questa query di manutenzione e' una richiesta esterna vera e
    // tiene il progetto sveglio.
    let pruned = null;
    if (new Date().getUTCMinutes() === 7) {
      pruned = await rpc("prune_net_responses");
    }

    return json(res, 200, {
      ok: true,
      inviati: rows.length,
      subscription_rimosse: gone.size,
      pulizia_pg_net: pruned,
      ms: Date.now() - started,
    });
  } catch (err) {
    console.error("[cron]", err.rpc || "", err.message);
    return json(res, 500, { ok: false, error: "tick fallito" });
  }
}
