// Tick dei promemoria, invocato da pg_cron dentro Supabase (una volta al minuto).
//
// Perche' non Vercel Cron: il piano Hobby limita i cron a UNA volta al giorno.
// pg_cron gira nel database, ha granularita' al minuto ed e' incluso nel free tier.
//
// Qui non c'e' logica di scheduling: "chi va avvisato adesso" lo decide
// claim_due_reminders() in SQL. Questa funzione firma e spedisce, nient'altro.

import { rpc } from "./_lib/db.js";
import { sendWebPush, pushConfigured } from "./_lib/push.js";
import { sendTelegram } from "./_lib/telegram.js";
import { json, methodOk } from "./_lib/http.js";

// Una stanza puo' avere piu' promemoria dovuti nello stesso tick: piu'
// lavatrici nello stesso turno, o un turno il cui "sposta il bucato"
// coincide con il "il tuo turno inizia" di quello successivo. Senza questo
// raggruppamento arriverebbero N notifiche push separate sullo stesso
// dispositivo (o N messaggi Telegram) invece di una sola.
function combineReminders(rows) {
  if (rows.length === 1) {
    return { title: rows[0].title, body: rows[0].body, tag: rows[0].tag };
  }
  const sameTitle = rows.every((r) => r.title === rows[0].title);
  return {
    title: sameTitle ? rows[0].title : "Bucato: piu' aggiornamenti",
    body: rows.map((r) => (sameTitle ? r.body : `${r.title} ${r.body}`)).join("\n"),
    tag: rows.map((r) => r.tag).join("+"),
  };
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
      // Raggruppa per destinatario (endpoint push / chat Telegram) prima di
      // spedire: piu' righe con lo stesso destinatario diventano una sola
      // notifica invece di una a testa. bump() resta per-riga cosi' il log
      // (reminder_log/report_reminder_results) continua a tracciare ogni
      // singolo promemoria, anche quando e' stato spedito in un gruppo.
      const pushGroups = new Map();
      const tgGroups = new Map();
      for (const r of rows) {
        if (r.endpoint) {
          const g = pushGroups.get(r.endpoint) || [];
          g.push(r);
          pushGroups.set(r.endpoint, g);
        }
        if (r.chat_id) {
          const g = tgGroups.get(r.chat_id) || [];
          g.push(r);
          tgGroups.set(r.chat_id, g);
        }
      }

      // In parallelo: sono richieste indipendenti verso servizi esterni, e il
      // tempo di esecuzione di una funzione serverless e' limitato.
      await Promise.all([
        ...[...pushGroups.entries()].map(async ([endpoint, group]) => {
          const { title, body, tag } = combineReminders(group);
          const outcome = await sendWebPush(
            { endpoint, keys: { p256dh: group[0].p256dh, auth: group[0].auth } },
            { title, body, url: "/", tag, kind: group.length === 1 ? group[0].kind : "combo" }
          );
          if (outcome === "gone") gone.add(endpoint);
          for (const r of group) bump(r, outcome === "ok" ? "ok" : "fail");
        }),
        ...[...tgGroups.entries()].map(async ([chatId, group]) => {
          const { title, body } = combineReminders(group);
          const t = await sendTelegram(chatId, title, body);
          for (const r of group) bump(r, t === "ok" ? "ok" : "fail");
        }),
      ]);
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
