-- ─────────────────────────────────────────────────────────────────────────────
-- FILE CONSOLIDATO: contiene lo stato ATTUALE, non quello iniziale.
--
-- Le migrazioni in migrations/ sono gia' incorporate qui. Non vanno riapplicate
-- sopra a questo file, e questo file non va rieseguito su un database gia' in
-- produzione: le due cose insieme creerebbero doppioni di funzione (due
-- overload della stessa RPC = errore PGRST203, che PostgREST non sa risolvere).
--
-- Ordine di ricostruzione e ruolo di ciascun file: vedi README.md.
-- ─────────────────────────────────────────────────────────────────────────────
-- EinaudiPlus — promemoria push
--
-- Sostituisce sendDueReminders() dei due Apps Script e le chiavi
-- PropertiesService usate per non inviare due volte.
--
-- La decisione di "chi va avvisato adesso" sta tutta qui, in SQL. La funzione
-- serverless si limita a firmare e spedire. Motivo: questa e' la logica che
-- vorrai ispezionare quando qualcosa non arriva, e in SQL la puoi interrogare
-- a mano; dentro PropertiesService era invisibile.

-- ─────────────────────────────────────────────────────────────────────────────
-- Quali promemoria genera una prenotazione
--
-- 'triple': inizio turno, fine lavaggio, fine asciugatura. E' cio' che usano
--           oggi entrambe le lavanderie.
-- 'single': solo l'avviso d'inizio turno. Resta come possibilita' ma nessuna
--           lavanderia la usa piu': era l'eredita' di laundry-Code.gs.
--
-- I testi sono copiati alla lettera dai due script: i residenti li riconoscono.
-- Anche i `tag` sono gli stessi, e contano: sw.js usa renotify:true con tag per
-- far collassare le notifiche ripetute.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function reminders_for_booking(p_booking_id bigint)
returns table (
  kind       text,
  fire_at    timestamptz,
  trigger_at timestamptz,
  title      text,
  body       text,
  tag        text
) language sql stable as $$
  with b as (
    select bk.id, bk.room, bk.day, bk.slot, bk.machine_code, bk.laundry_id,
           l.reminder_mode, l.slot_len_min, l.tz,
           slot_start_at(bk.laundry_id, bk.week_start, bk.day, bk.slot) as ss
    from laundry_booking bk
    join laundry l on l.id = bk.laundry_id
    where bk.id = p_booking_id
  ),
  t as (
    select b.*,
           -- Orario della LAVATRICE: dall'inizio del turno alla sua fine.
           to_char(b.ss at time zone b.tz, 'HH24:MI') as h_lav_da,
           to_char((b.ss + make_interval(mins => b.slot_len_min)) at time zone b.tz, 'HH24:MI') as h_lav_a,
           -- Orario dell'ASCIUGATRICE: il turno successivo, riservato in automatico.
           to_char((b.ss + make_interval(mins => b.slot_len_min)) at time zone b.tz, 'HH24:MI') as h_asc_da,
           to_char((b.ss + make_interval(mins => 2 * b.slot_len_min)) at time zone b.tz, 'HH24:MI') as h_asc_a,
           -- 'W-A' -> 'Lavatrice A' / 'Asciugatrice A'
           'Lavatrice '    || right(b.machine_code, 1) as nome_lav,
           'Asciugatrice ' || right(b.machine_code, 1) as nome_asc
    from b
  )
  -- Il `tag` è lo stesso per tutti e tre, di proposito: i servizi push
  -- sostituiscono la notifica precedente con lo stesso tag invece di
  -- accumularle. I tre messaggi sono passi successivi dello stesso bucato,
  -- quindi conta solo l'ultimo — e chi guarda il telefono a fine ciclo trova
  -- "Ritira i tuoi vestiti", non tre avvisi sovrapposti.

  -- 1. Inizio turno: unico promemoria in 'single', il primo dei tre in 'triple'.
  select 'pre',
         t.ss,
         t.ss - interval '16 minutes',
         'Il tuo turno inizia tra poco!',
         t.nome_lav || ' · ' || t.h_lav_da || '–' || t.h_lav_a,
         'laundry-' || t.day || '-' || t.slot || '-' || t.machine_code
  from t

  union all

  -- 2. La lavatrice ha finito: il bucato va spostato.
  select 'washerend',
         t.ss + make_interval(mins => t.slot_len_min),
         t.ss + make_interval(mins => t.slot_len_min),
         'Sposta i vestiti in asciugatrice!',
         t.nome_asc || ' · ' || t.h_asc_da || '–' || t.h_asc_a,
         'laundry-' || t.day || '-' || t.slot || '-' || t.machine_code
  from t where t.reminder_mode = 'triple'

  union all

  -- 3. Anche l'asciugatrice ha finito.
  select 'dryerend',
         t.ss + make_interval(mins => 2 * t.slot_len_min),
         t.ss + make_interval(mins => 2 * t.slot_len_min),
         'Ritira i tuoi vestiti!',
         t.nome_asc || ' · ' || t.h_asc_da || '–' || t.h_asc_a,
         'laundry-' || t.day || '-' || t.slot || '-' || t.machine_code
  from t where t.reminder_mode = 'triple';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Il cuore: rivendica i promemoria dovuti e restituisce i destinatari.
--
-- "Rivendica prima di spedire": la INSERT ... RETURNING restituisce solo le
-- righe create DA QUESTA transazione. Se due tick si sovrappongono, o se Vercel
-- ritenta la richiesta, il secondo non ottiene nulla e non spedisce. Il doppio
-- invio diventa impossibile, non solo improbabile.
--
-- La finestra di grazia sostituisce le due forme di finestra del vecchio codice
-- (before/after con windowMin diversi). Con la rivendicazione atomica non serve
-- distinguerle: "spedisci una volta sola, entro N minuti da quando e' dovuto".
-- In piu' sopravvive a un'interruzione del cron fino a N minuti, mentre prima
-- il promemoria saltava e basta.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function claim_due_reminders(p_grace_min int default 10)
returns table (
  booking_id bigint,
  kind       text,
  room       text,
  title      text,
  body       text,
  tag        text,
  endpoint   text,
  p256dh     text,
  auth       text,
  chat_id    text
)
-- `language sql` e non plpgsql: con RETURNS TABLE i nomi delle colonne di
-- ritorno farebbero ombra ai riferimenti dentro la query ("booking_id is
-- ambiguous"). In SQL puro il problema non esiste.
language sql as $$
  with due as (
    select b.id as booking_id, r.kind, r.fire_at, r.trigger_at,
           r.title, r.body, r.tag, b.room, b.laundry_id
    from laundry_booking b
    join laundry l on l.id = b.laundry_id
    cross join lateral reminders_for_booking(b.id) r
    -- Anche la settimana precedente, e non e' una rete di sicurezza: gli slot
    -- dal 14 in poi iniziano DOPO la mezzanotte del loro giorno. Il turno 15
    -- di domenica si svolge lunedi' dall'01:45 alle 03:00, quindi appartiene
    -- alla settimana appena finita ma i suoi promemoria vanno mandati nella
    -- nuova. Filtrando sulla sola settimana corrente, chi lava di notte fra
    -- domenica e lunedi' non riceveva "lavatrice terminata" ne' "ritira il
    -- bucato".
    --
    -- Allargare non fa danni: e' trigger_at a decidere cosa e' dovuto, e
    -- reminder_log a garantire che parta una volta sola.
    where b.week_start >= current_week_start(l.tz) - 7
      and now() >= r.trigger_at
      and now() <  r.trigger_at + make_interval(mins => p_grace_min)
  ),
  claimed as (
    insert into reminder_log (booking_id, kind, fire_at)
    select d.booking_id, d.kind, d.fire_at from due d
    on conflict (booking_id, kind) do nothing
    returning reminder_log.booking_id as bid, reminder_log.kind as k
  )
  select d.booking_id, d.kind, d.room, d.title, d.body, d.tag,
         s.endpoint, s.p256dh, s.auth, tg.chat_id
  from claimed c
  join due d on d.booking_id = c.bid and d.kind = c.k
  -- Un residente puo' avere piu' dispositivi: una riga per ciascuno.
  left join push_sub s on s.laundry_id = d.laundry_id and s.room = d.room
  left join telegram_sub tg on tg.laundry_id = d.laundry_id
                           and tg.room = d.room
                           and tg.verified_at is not null;
$$;

-- Riporta l'esito e pota le subscription morte.
-- I servizi push rispondono 404/410 quando l'utente ha disinstallato l'app o
-- revocato il permesso: quelle righe non serviranno mai piu'.
create or replace function report_reminder_results(
  p_gone text[] default '{}',
  p_stats jsonb default '[]'
) returns jsonb language plpgsql as $$
declare
  v_pruned int := 0;
begin
  if array_length(p_gone, 1) > 0 then
    delete from push_sub where endpoint = any(p_gone);
    get diagnostics v_pruned = row_count;
  end if;

  update reminder_log rl
  set sent_ok   = coalesce((s->>'ok')::int, 0),
      sent_fail = coalesce((s->>'fail')::int, 0)
  from jsonb_array_elements(p_stats) s
  where rl.booking_id = (s->>'booking_id')::bigint
    and rl.kind = (s->>'kind');

  return jsonb_build_object('ok', true, 'pruned', v_pruned);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Manutenzione
-- ─────────────────────────────────────────────────────────────────────────────

-- pg_net archivia OGNI risposta HTTP in net._http_response. A un tick al minuto
-- sono ~43.000 righe al mese, e non si cancellano da sole: senza questa pulizia
-- il progetto free finisce lo spazio.
create or replace function prune_net_responses()
returns int language plpgsql security definer as $$
declare v_n int;
begin
  delete from net._http_response where created < now() - interval '3 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Le prenotazioni passate non servono a nessuno: si tiene la settimana corrente
-- piu' la precedente, e basta.
--
-- La precedente si tiene per un motivo pratico, non per archivio: quando
-- qualcuno lascia il bucato in lavatrice, l'unico modo per sapere di chi e' e'
-- guardare chi aveva il turno prima. Con zero settimane di storico, il pulsante
-- "settimana precedente" del pannello admin non mostrerebbe mai nulla.
--
-- Il vincolo ON DELETE CASCADE porta via anche le righe di reminder_log.
create or replace function prune_old_weeks(p_keep_weeks int default 1)
returns int language plpgsql as $$
declare v_n int;
begin
  delete from laundry_booking
  where week_start < current_week_start('Europe/Rome') - (p_keep_weeks * 7);
  get diagnostics v_n = row_count;

  delete from space_booking
  where week_start < current_week_start('Europe/Rome') - (p_keep_weeks * 7);

  delete from rate_limit where window_start < now() - interval '2 days';
  delete from audit_log  where at < now() - interval '180 days';

  -- Codici Telegram generati e mai usati: non devono restare validi per sempre.
  perform telegram_prune_pending(24);

  return v_n;
end;
$$;
