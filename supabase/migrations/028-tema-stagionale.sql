-- Tema stagionale decorativo (Halloween, Natale con la neve, ecc.),
-- attivabile e disattivabile dal pannello sistemista in qualsiasi momento.
-- Consolidato in supabase/tema.sql; qui la versione da applicare a un
-- database gia' in produzione.
--
-- Non e' una preferenza per residente come tema.ts lato client (chiaro/scuro,
-- salvato in localStorage): e' UNA sola scelta per tutta l'app, quindi vive
-- nel database e non nel browser. Riga singola: il "check (id)" sull'unica
-- chiave possibile impedisce che ne nasca mai una seconda.

create table if not exists app_theme (
  id         boolean primary key default true check (id),
  tema       text not null default 'nessuno' check (tema in ('nessuno', 'halloween', 'natale')),
  updated_at timestamptz not null default now()
);

insert into app_theme (id) values (true) on conflict (id) do nothing;

alter table app_theme enable row level security;

create or replace function app_theme_get()
returns text language sql stable as $$
  select tema from app_theme where id = true;
$$;

create or replace function sysadmin_set_theme(p_tema text)
returns jsonb language plpgsql as $$
begin
  if p_tema not in ('nessuno', 'halloween', 'natale') then
    return jsonb_build_object('ok', false, 'error', 'tema non valido');
  end if;
  update app_theme set tema = p_tema, updated_at = now() where id = true;
  return jsonb_build_object('ok', true, 'tema', p_tema);
end;
$$;

-- Aggiunge il tema attivo alla foto che l'app legge a ogni avvio.
create or replace function laundry_snapshot(p_room text default null)
returns jsonb language plpgsql stable as $$
declare
  v_id smallint;
  v_l  laundry%rowtype;
  v_ws date;
begin
  v_id := coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));
  select * into v_l from laundry where id = v_id;
  v_ws := current_laundry_week_start(v_l.id);

  return jsonb_build_object(
    'ok',     true,
    'week',   week_snapshot(v_id, v_ws),
    'status', status_snapshot(v_id),
    'slots',  v_l.n_slots,
    'tema',   app_theme_get()
  );
end;
$$;

revoke all on function app_theme_get() from public, anon, authenticated;
grant execute on function app_theme_get() to service_role;

revoke all on function sysadmin_set_theme(text) from public, anon, authenticated;
grant execute on function sysadmin_set_theme(text) to service_role;
