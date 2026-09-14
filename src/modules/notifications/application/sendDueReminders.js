// Use-case: tick dei promemoria, invocato dal cron una volta al minuto.
//
// Qui non c'è logica di scheduling: "chi va avvisato adesso" lo decide
// claim_due_reminders() in SQL. Questo use-case raggruppa, firma e spedisce,
// nient'altro.

import { combineReminders } from "../domain/reminders.js";

export async function sendDueReminders({ graceMin = 10 }, { notificationsRepository, pushSender, telegramSender }) {
  // Rivendica e spedisce in un colpo solo: le righe tornate sono già marcate
  // come inviate, quindi un tick sovrapposto non le rivedrà.
  const due = await notificationsRepository.claimDueReminders({ graceMin });
  const rows = Array.isArray(due) ? due : [];

  const gone = new Set();
  const stats = new Map(); // "bookingId:kind" -> {ok, fail}
  const bump = (r, field) => {
    const k = `${r.booking_id}:${r.kind}`;
    const s = stats.get(k) || { booking_id: r.booking_id, kind: r.kind, ok: 0, fail: 0 };
    s[field]++;
    stats.set(k, s);
  };

  // Fedele all'originale: l'intero invio (push E Telegram) resta condizionato
  // a pushSender.configured(), non solo la parte push. È un comportamento
  // preesistente, non introdotto qui — in pratica in questo deployment i due
  // canali sono sempre configurati insieme, ma vale la pena saperlo.
  if (rows.length && pushSender.configured()) {
    // Raggruppa per destinatario (endpoint push / chat Telegram) prima di
    // spedire: più righe con lo stesso destinatario diventano una sola
    // notifica invece di una a testa. bump() resta per-riga così il log
    // continua a tracciare ogni singolo promemoria, anche se spedito in gruppo.
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
    // tempo di esecuzione di una funzione serverless è limitato.
    await Promise.all([
      ...[...pushGroups.entries()].map(async ([endpoint, group]) => {
        const { title, body, tag } = combineReminders(group);
        const outcome = await pushSender.send(
          { endpoint, keys: { p256dh: group[0].p256dh, auth: group[0].auth } },
          { title, body, url: "/", tag, kind: group.length === 1 ? group[0].kind : "combo" },
        );
        if (outcome === "gone") gone.add(endpoint);
        for (const r of group) bump(r, outcome === "ok" ? "ok" : "fail");
      }),
      ...[...tgGroups.entries()].map(async ([chatId, group]) => {
        const { title, body } = combineReminders(group);
        const t = await telegramSender.send(chatId, title, body);
        for (const r of group) bump(r, t === "ok" ? "ok" : "fail");
      }),
    ]);
  }

  await notificationsRepository.reportReminderResults({ gone: [...gone], stats: [...stats.values()] });

  // Doppio scopo. Uno: pulizia periodica di net._http_response, che pg_net
  // riempie a ogni chiamata e che nessuno svuota da solo.
  // Due: i progetti Supabase gratuiti vanno in pausa dopo 7 giorni di
  // inattività, misurata sulle richieste API. Questa query di manutenzione è
  // una richiesta esterna vera e tiene il progetto sveglio.
  let pruned = null;
  if (new Date().getUTCMinutes() === 7) {
    pruned = await notificationsRepository.pruneNetResponses();
  }

  return {
    ok: true,
    inviati: rows.length,
    subscription_rimosse: gone.size,
    pulizia_pg_net: pruned,
  };
}
