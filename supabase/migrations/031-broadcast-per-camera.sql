-- Notifica broadcast anche a una sola camera, non solo a tutte.
--
-- sysadmin_all_push_subs/sysadmin_all_telegram_subs leggevano sempre tutta la
-- tabella: bastava per "avvisa tutti", non per "avvisa la 215" (es. una
-- consegna, un problema di quella singola camera). push_sub e telegram_sub
-- hanno gia' la colonna room (serve ai promemoria lavanderia): la aggiungiamo
-- come filtro opzionale invece di creare percorsi nuovi.
--
-- Il vecchio sysadmin_all_push_subs()/sysadmin_all_telegram_subs() vanno
-- tolti esplicitamente: una funzione con un parametro in piu' non li
-- sostituisce, li affianca — due overload della stessa RPC che PostgREST non
-- sa risolvere (PGRST203).
drop function if exists sysadmin_all_push_subs();
drop function if exists sysadmin_all_telegram_subs();

create or replace function sysadmin_all_push_subs(p_room text default null)
returns jsonb language sql stable as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', id, 'endpoint', endpoint, 'p256dh', p256dh, 'auth', auth
    )),
    '[]'::jsonb
  )
  from push_sub
  where p_room is null or room = p_room;
$$;

create or replace function sysadmin_all_telegram_subs(p_room text default null)
returns jsonb language sql stable as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('chat_id', chat_id)),
    '[]'::jsonb
  )
  from telegram_sub
  where verified_at is not null
    and (p_room is null or room = p_room);
$$;

revoke all on function sysadmin_all_push_subs(text) from public, anon, authenticated;
grant execute on function sysadmin_all_push_subs(text) to service_role;

revoke all on function sysadmin_all_telegram_subs(text) from public, anon, authenticated;
grant execute on function sysadmin_all_telegram_subs(text) to service_role;
