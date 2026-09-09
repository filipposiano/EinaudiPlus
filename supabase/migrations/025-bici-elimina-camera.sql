-- Bici: eliminare la dichiarazione di UNA camera, non solo tutte insieme.
--
-- sysadmin_purge (e prima ancora bike_purge, dalla 024) azzerano tutto, per
-- il reset annuale. Ma "questa camera ha lasciato il collegio a metà anno" o
-- "si è sbagliata a toccare" sono casi singoli, e per quelli l'unica strada
-- era "Cancella tutte" — la stessa sproporzione che sysadmin_delete_push_sub
-- e sysadmin_delete_telegram_sub risolvono per le iscrizioni alle notifiche.
-- Questa è la stessa cosa per le bici.

create or replace function bike_delete_room(p_room text)
returns jsonb language plpgsql as $$
declare v_n int;
begin
  delete from bike where room = p_room;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_n > 0);
end;
$$;

revoke all on function bike_delete_room(text) from public, anon, authenticated;
grant execute on function bike_delete_room(text) to service_role;
