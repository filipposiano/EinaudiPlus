-- Pianificazione dei promemoria dentro Supabase.
--
-- Perche' qui e non su Vercel: il piano Hobby limita i cron a UNA volta al
-- giorno, e i promemoria devono essere valutati ogni minuto. pg_cron gira nel
-- database, e' incluso nel free tier e ha granularita' al minuto (quattro volte
-- meglio del trigger Apps Script, che girava ogni 5).
--
-- ATTENZIONE: i due segnaposto vanno sostituiti prima di eseguire.
--   {{APP_URL}}      es. https://einaudi-plus.vercel.app
--   {{CRON_SECRET}}  lo stesso valore che sta nelle env var di Vercel

-- ─────────────────────────────────────────────────────────────────────────────
-- Il segreto nel Vault, non nel job.
--
-- Il corpo dei job pg_cron e' leggibile in chiaro da cron.job: scriverci dentro
-- il segreto significherebbe lasciarlo esposto a chiunque possa interrogare
-- quella tabella. Nel Vault e' cifrato a riposo.
-- ─────────────────────────────────────────────────────────────────────────────

select vault.create_secret('{{CRON_SECRET}}', 'cron_secret', 'Segreto condiviso con /api/cron su Vercel');
select vault.create_secret('{{APP_URL}}',     'app_url',     'Origine dell app su Vercel');

-- ─────────────────────────────────────────────────────────────────────────────
-- Il tick, ogni minuto.
--
-- pg_net e' asincrono: net.http_post accoda la richiesta e ritorna subito, cosi'
-- il job non resta appeso se Vercel e' lento. L'esito finisce in
-- net._http_response, che va potato (ci pensa /api/cron una volta all'ora).
-- ─────────────────────────────────────────────────────────────────────────────

select cron.schedule(
  'promemoria-lavanderia',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);

-- Prenotazioni ricorrenti: scrive nella settimana corrente le prenotazioni
-- previste dalle regole del sistemista.
--
-- Ogni giorno e non solo il lunedi': la funzione e' idempotente (ON CONFLICT
-- DO NOTHING), quindi rieseguirla non fa danni, e cosi' si auto-ripara se una
-- notte il job salta. Alle 02:00 UTC, che e' dopo la mezzanotte di Roma sia
-- con l'ora solare sia con quella legale.
select cron.schedule('ricorrenti', '0 2 * * *', $job$ select apply_recurring(0); $job$);

-- Potatura settimanale delle settimane vecchie: le prenotazioni oltre le 8
-- settimane non servono piu'. Il CASCADE porta via anche reminder_log.
-- Lunedi' alle 04:00 UTC, quando non c'e' nessuno sveglio.
select cron.schedule('potatura-settimanale', '0 4 * * 1', $job$ select prune_old_weeks(8); $job$);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verifica e diagnostica
-- ─────────────────────────────────────────────────────────────────────────────

-- I job registrati:
--   select jobid, jobname, schedule, active from cron.job;
--
-- Le ultime esecuzioni (qui si vede se il job parte):
--   select jobname, status, return_message, start_time
--   from cron.job_run_details order by start_time desc limit 20;
--
-- Le risposte HTTP di Vercel (qui si vede se l'endpoint risponde 200):
--   select id, status_code, content, created
--   from net._http_response order by created desc limit 20;
--
-- I promemoria effettivamente spediti:
--   select booking_id, kind, fire_at, claimed_at, sent_ok, sent_fail
--   from reminder_log order by claimed_at desc limit 20;
--
-- Per fermare tutto:
--   select cron.unschedule('promemoria-lavanderia');
