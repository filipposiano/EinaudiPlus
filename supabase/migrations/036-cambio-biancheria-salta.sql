-- Aggiunge la possibilità di saltare un martedì (nessun cambio biancheria
-- quella settimana), senza disturbare l'alternanza grande/piccolo delle
-- settimane successive. Consolidato in supabase/cambio-biancheria.sql; qui la
-- versione da applicare a un database già in produzione (dopo migrations/035).
--
-- Un martedì saltato non consuma un turno della sequenza: il martedì dopo
-- torna al tipo che avrebbe avuto comunque, come se quel salto non fosse mai
-- esistito ai fini del conteggio — stesso principio di conference_eccezione
-- in polivalente.sql, un'eccezione puntuale su una regola che resta
-- invariata.

create table if not exists linen_change_skip (
  skip_date date primary key
);

alter table linen_change_skip enable row level security;

-- Ridefinita per controllare il salto PRIMA dell'alternanza. Il resto della
-- funzione (ancora, parità delle settimane) è invariato rispetto a
-- migrations/035.
create or replace function linen_change_type_for(p_tuesday date)
returns text language plpgsql stable as $$
declare
  v_ancora_data date;
  v_ancora_tipo text;
  v_settimane   int;
begin
  if exists (select 1 from linen_change_skip where skip_date = p_tuesday) then
    return 'nessuno';
  end if;

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

-- Ridefinita per includere anche i martedì saltati (finestra: ultimi 7
-- giorni in poi, solo per non allungare la lista con salti ormai passati —
-- la riga resta comunque nella tabella, non è una pulizia).
create or replace function linen_change_admin_get()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ancora_data', (select anchor_date from linen_change_anchor where id = true),
    'ancora_tipo', (select anchor_type from linen_change_anchor where id = true),
    'salta', coalesce((
      select jsonb_agg(skip_date order by skip_date)
      from linen_change_skip
      where skip_date >= current_date - interval '7 days'
    ), '[]'::jsonb)
  );
$$;

create or replace function linen_change_set_skip(p_date date, p_skip boolean)
returns jsonb language plpgsql as $$
begin
  if extract(isodow from p_date) <> 2 then
    return jsonb_build_object('ok', false, 'error', 'la data deve essere un martedì');
  end if;

  if p_skip then
    insert into linen_change_skip (skip_date) values (p_date) on conflict (skip_date) do nothing;
  else
    delete from linen_change_skip where skip_date = p_date;
  end if;

  return jsonb_build_object('ok', true, 'data', p_date, 'salta', p_skip);
end;
$$;

revoke all on function linen_change_set_skip(date, boolean) from public, anon, authenticated;
grant execute on function linen_change_set_skip(date, boolean) to service_role;
