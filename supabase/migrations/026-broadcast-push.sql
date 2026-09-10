-- Notifica manuale dal pannello sistemista a tutti i dispositivi iscritti.
--
-- push_sub esisteva gia' solo per i promemoria lavanderia (un'iscrizione e'
-- legata a stanza + lavanderia), ma l'iscrizione push vera e propria e' del
-- BROWSER, non del promemoria: lo stesso service worker che mostra "lavatrice
-- finita" puo' mostrare qualunque altro messaggio. Non serve una tabella
-- nuova, solo due funzioni che leggono/potano push_sub senza passare dal
-- filtro per lavanderia/camera che serve a claim_due_reminders.

create or replace function sysadmin_all_push_subs()
returns jsonb language sql stable as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', id, 'endpoint', endpoint, 'p256dh', p256dh, 'auth', auth
    )),
    '[]'::jsonb
  )
  from push_sub;
$$;

-- Stessa logica di potatura di report_reminder_results, ma per id invece che
-- per endpoint: il chiamante (api/admin/data.js) ha gia' l'id da
-- sysadmin_all_push_subs, non serve fargli ricordare l'endpoint.
create or replace function sysadmin_prune_push_subs(p_ids bigint[])
returns jsonb language plpgsql as $$
declare
  v_pruned int := 0;
begin
  if array_length(p_ids, 1) > 0 then
    delete from push_sub where id = any(p_ids);
    get diagnostics v_pruned = row_count;
  end if;
  return jsonb_build_object('ok', true, 'pruned', v_pruned);
end;
$$;

revoke all on function sysadmin_all_push_subs() from public, anon, authenticated;
grant execute on function sysadmin_all_push_subs() to service_role;

revoke all on function sysadmin_prune_push_subs(bigint[]) from public, anon, authenticated;
grant execute on function sysadmin_prune_push_subs(bigint[]) to service_role;
