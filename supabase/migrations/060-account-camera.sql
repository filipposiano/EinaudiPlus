-- v1.10: delegato e sistemista possono avere una camera associata (chi
-- amministra spesso è anche un residente), e passare fra "la mia camera" e
-- "Direzione" restando connessi. Il sistemista la imposta dalla scheda
-- Account. Il server la restituisce al login (account_by_username).
--
-- Nessuna firma esistente cambia. Consolidato in supabase/account.sql.

alter table admin_account add column if not exists camera text;

create or replace function account_by_username(p_username text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', id, 'username', username, 'password_hash', password_hash,
    'ruolo', ruolo, 'attivo', attivo, 'deve_cambiare_password', deve_cambiare_password,
    'camera', camera
  )
  from admin_account
  where username = p_username
  limit 1;
$$;

create or replace function account_list()
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'items', coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'username', username, 'ruolo', ruolo, 'attivo', attivo,
    'created_at', created_at, 'password_at', password_at,
    'deve_cambiare_password', deve_cambiare_password, 'camera', camera
  ) order by created_at), '[]'::jsonb))
  from admin_account;
$$;

-- v1.10: la camera di un delegato o di un sistemista — chi amministra
-- spesso è anche un residente. Con la camera associata può passare, restando
-- connesso, fra "la mia camera" e "Direzione" (vedi App.tsx). Solo per
-- delegato e sistemista: FDO e staff non sono residenti. null la toglie.
create or replace function account_set_camera(p_id bigint, p_camera text)
returns jsonb language plpgsql as $$
declare
  v_ruolo text;
  v_camera text := nullif(btrim(coalesce(p_camera, '')), '');
begin
  select ruolo into v_ruolo from admin_account where id = p_id;
  if v_ruolo is null then
    return jsonb_build_object('ok', false, 'error', 'account non trovato');
  end if;
  if v_camera is not null and v_ruolo not in ('delegato', 'sistemista') then
    return jsonb_build_object('ok', false, 'error', 'solo delegato e sistemista possono avere una camera');
  end if;
  if v_camera is not null and v_camera !~ '^[0-9]{1,4}(-?[abAB])?$' then
    return jsonb_build_object('ok', false, 'error', 'numero di camera non valido');
  end if;

  update admin_account set camera = v_camera where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function account_set_camera(bigint, text) from public, anon, authenticated;
grant execute on function account_set_camera(bigint, text) to service_role;
