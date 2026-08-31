-- Le segnalazioni (tabella feedback) erano l'unica fra i dati che accumulano
-- nel tempo a non avere una scadenza: prenotazioni e audit_log vengono gia'
-- pulite periodicamente da prune_old_weeks, feedback restava per sempre,
-- anche dopo essere stata gestita (handled_at valorizzato). Minimizzazione
-- dei dati: stessa finestra dell'audit_log, 180 giorni, per coerenza.
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

  -- Le segnalazioni non avevano scadenza: a differenza di prenotazioni e
  -- audit_log restavano per sempre, anche dopo essere state gestite. Stessa
  -- finestra dell'audit_log, per coerenza e minimizzazione dei dati.
  delete from feedback where created_at < now() - interval '180 days';

  -- Codici Telegram generati e mai usati: non devono restare validi per sempre.
  perform telegram_prune_pending(24);

  return v_n;
end;
$$;
