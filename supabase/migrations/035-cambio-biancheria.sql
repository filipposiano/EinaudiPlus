-- Cambio biancheria del martedì mattina (grande o piccolo), impostabile da
-- FDO e sistemista. Consolidato in supabase/cambio-biancheria.sql; qui la
-- versione da applicare a un database già in produzione, più l'aggiornamento
-- a laundry_snapshot (già esistente prima di questa migrazione) che incorpora
-- il tipo risolto per oggi.
--
-- Non riservato al sistemista come il tema stagionale (migrations/028): è
-- una decisione operativa di portineria, come lo stato delle macchine, non
-- una scelta estetica che cambia cosa vede ogni residente.
--
-- Si alternano da soli, settimana per settimana: un'ancora (un martedì + il
-- suo tipo) basta a calcolare ogni altro martedì, passato o futuro, per
-- parità di settimane trascorse da quel punto. Quando la sequenza va rotta
-- (es. il collegio chiude e si riparte dal grande dopo la riapertura) si
-- sposta semplicemente l'ancora al martedì di ripartenza: tutto ciò che
-- viene dopo si ricalcola da lì.
--
-- Riga singola, stesso principio di app_theme. NESSUNA riga di default:
-- finché nessun amministratore l'ha impostata, linen_change_current() torna
-- null e la dashboard non mostra nulla, invece di indovinare un'ancora
-- arbitraria che quasi certamente sarebbe sbagliata.

create table if not exists linen_change_anchor (
  id           boolean primary key default true check (id),
  anchor_date  date not null,
  anchor_type  text not null check (anchor_type in ('grande', 'piccolo')),
  updated_at   timestamptz not null default now()
);

alter table linen_change_anchor enable row level security;

create or replace function linen_change_current_tuesday(p_tz text default 'Europe/Rome')
returns date language sql stable as $$
  select (date_trunc('week', now() at time zone p_tz) + interval '1 day')::date;
$$;

create or replace function linen_change_type_for(p_tuesday date)
returns text language plpgsql stable as $$
declare
  v_ancora_data date;
  v_ancora_tipo text;
  v_settimane   int;
begin
  select anchor_date, anchor_type into v_ancora_data, v_ancora_tipo
  from linen_change_anchor where id = true;

  if v_ancora_data is null then
    return null;
  end if;

  v_settimane := (p_tuesday - v_ancora_data) / 7;
  if mod(v_settimane, 2) = 0 then
    return v_ancora_tipo;
  end if;
  return case v_ancora_tipo when 'grande' then 'piccolo' else 'grande' end;
end;
$$;

create or replace function linen_change_current()
returns text language sql stable as $$
  select linen_change_type_for(linen_change_current_tuesday());
$$;

create or replace function linen_change_admin_get()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ancora_data', anchor_date,
    'ancora_tipo', anchor_type
  ) from linen_change_anchor where id = true;
$$;

create or replace function linen_change_set_anchor(p_anchor_date date, p_anchor_type text)
returns jsonb language plpgsql as $$
begin
  if p_anchor_type not in ('grande', 'piccolo') then
    return jsonb_build_object('ok', false, 'error', 'tipo non valido');
  end if;
  if extract(isodow from p_anchor_date) <> 2 then
    return jsonb_build_object('ok', false, 'error', 'la data deve essere un martedì');
  end if;

  insert into linen_change_anchor (id, anchor_date, anchor_type, updated_at)
  values (true, p_anchor_date, p_anchor_type, now())
  on conflict (id) do update
    set anchor_date = excluded.anchor_date,
        anchor_type = excluded.anchor_type,
        updated_at  = now();

  return jsonb_build_object('ok', true, 'ancora_data', p_anchor_date, 'ancora_tipo', p_anchor_type);
end;
$$;

-- Aggiunge il tipo risolto per oggi alla foto che l'app legge a ogni avvio.
create or replace function laundry_snapshot(p_room text default null)
returns jsonb language plpgsql stable as $$
declare
  v_id smallint;
  v_l  laundry%rowtype;
begin
  v_id := coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));
  select * into v_l from laundry where id = v_id;

  return jsonb_build_object(
    'ok',     true,
    'week',   week_snapshot_mixed(v_id),
    'status', status_snapshot(v_id),
    'slots',  v_l.n_slots,
    'tema',   app_theme_get(),
    'cambio_biancheria', linen_change_current()
  );
end;
$$;

revoke all on function linen_change_current_tuesday(text) from public, anon, authenticated;
revoke all on function linen_change_type_for(date) from public, anon, authenticated;
revoke all on function linen_change_current() from public, anon, authenticated;
revoke all on function linen_change_admin_get() from public, anon, authenticated;
revoke all on function linen_change_set_anchor(date, text) from public, anon, authenticated;

grant execute on function linen_change_current_tuesday(text) to service_role;
grant execute on function linen_change_type_for(date) to service_role;
grant execute on function linen_change_current() to service_role;
grant execute on function linen_change_admin_get() to service_role;
grant execute on function linen_change_set_anchor(date, text) to service_role;
