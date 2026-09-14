-- Anticipa i promemoria "sposta in asciugatrice" e "ritira il bucato".
--
-- Finora 'washerend' e 'dryerend' avevano trigger_at = fire_at: il promemoria
-- diventava dovuto esattamente alla fine del turno, e con la finestra di
-- grazia di 10 minuti di claim_due_reminders arrivava fra 0 e 10 minuti DOPO
-- che la macchina si era gia' fermata — chi lo leggeva trovava il bucato la'
-- da un po'.
--
-- Anticipando trigger_at di 15 minuti, la stessa finestra di grazia lo rende
-- dovuto fra 15 e 5 minuti PRIMA della fine: chi lo riceve fa in tempo ad
-- arrivare proprio quando la macchina si ferma davvero, invece di scoprirlo
-- dopo. fire_at non cambia: resta il momento a cui il promemoria si
-- riferisce (e la chiave con cui reminder_log lo tiene distinto da 'pre'),
-- solo trigger_at si sposta.
--
-- 'pre' (l'avviso di inizio turno) non cambia: usa gia' lo stesso schema,
-- con un anticipo di 16 minuti invece di 15 — vedi reminders.sql.

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
           to_char(b.ss at time zone b.tz, 'HH24:MI') as h_lav_da,
           to_char((b.ss + make_interval(mins => b.slot_len_min)) at time zone b.tz, 'HH24:MI') as h_lav_a,
           to_char((b.ss + make_interval(mins => b.slot_len_min)) at time zone b.tz, 'HH24:MI') as h_asc_da,
           to_char((b.ss + make_interval(mins => 2 * b.slot_len_min)) at time zone b.tz, 'HH24:MI') as h_asc_a,
           'Lavatrice '    || right(b.machine_code, 1) as nome_lav,
           'Asciugatrice ' || right(b.machine_code, 1) as nome_asc
    from b
  )
  select 'pre',
         t.ss,
         t.ss - interval '16 minutes',
         'Il tuo turno inizia tra poco!',
         t.nome_lav || ' · ' || t.h_lav_da || '–' || t.h_lav_a,
         'laundry-' || t.day || '-' || t.slot || '-' || t.machine_code
  from t

  union all

  select 'washerend',
         t.ss + make_interval(mins => t.slot_len_min),
         t.ss + make_interval(mins => t.slot_len_min) - interval '15 minutes',
         'Sposta i vestiti in asciugatrice!',
         t.nome_asc || ' · ' || t.h_asc_da || '–' || t.h_asc_a,
         'laundry-' || t.day || '-' || t.slot || '-' || t.machine_code
  from t where t.reminder_mode = 'triple'

  union all

  select 'dryerend',
         t.ss + make_interval(mins => 2 * t.slot_len_min),
         t.ss + make_interval(mins => 2 * t.slot_len_min) - interval '15 minutes',
         'Ritira i tuoi vestiti!',
         t.nome_asc || ' · ' || t.h_asc_da || '–' || t.h_asc_a,
         'laundry-' || t.day || '-' || t.slot || '-' || t.machine_code
  from t where t.reminder_mode = 'triple';
$$;
