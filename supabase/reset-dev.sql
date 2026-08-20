-- Svuota i dati di esercizio lasciati dai test, tenendo la configurazione.
--
-- Da eseguire prima del cutover, per partire da un database pulito.
-- NON tocca laundry, machine, room_space: quelle sono configurazione, non dati.

create or replace function reset_dev_data()
returns jsonb language plpgsql as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_n int;
begin
  -- I `where ... is not null` sono sempre veri e servono a soddisfare
  -- l'estensione safeupdate di Supabase, che rifiuta DELETE e UPDATE privi di
  -- WHERE quando l'istruzione passa dalla connessione di PostgREST. Senza,
  -- la funzione fallisce con "21000: DELETE requires a WHERE clause".
  delete from laundry_booking where id is not null;   get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('prenotazioni', v_n);

  delete from space_booking where id is not null;     get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('sale', v_n);

  delete from feedback where id is not null;          get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('segnalazioni', v_n);

  delete from telegram_sub where id is not null;      get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('telegram', v_n);

  delete from push_sub where id is not null;          get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('push', v_n);

  delete from rate_limit where bucket is not null;
  delete from audit_log where id is not null;

  -- reminder_log si svuota da solo: ON DELETE CASCADE da laundry_booking.

  -- Le macchine tornano tutte in servizio, tranne quelle che non esistono.
  update machine set is_oos = not bookable where laundry_id is not null;

  return jsonb_build_object('ok', true, 'cancellati', v_out);
end;
$$;
