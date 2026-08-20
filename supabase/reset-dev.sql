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
  delete from laundry_booking;   get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('prenotazioni', v_n);

  delete from space_booking;     get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('sale', v_n);

  delete from feedback;          get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('segnalazioni', v_n);

  delete from telegram_sub;      get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('telegram', v_n);

  delete from push_sub;          get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('push', v_n);

  delete from rate_limit;
  delete from audit_log;

  -- reminder_log si svuota da solo: ON DELETE CASCADE da laundry_booking.

  -- Le macchine tornano tutte in servizio, tranne quelle che non esistono.
  update machine set is_oos = not bookable;

  return jsonb_build_object('ok', true, 'cancellati', v_out);
end;
$$;
