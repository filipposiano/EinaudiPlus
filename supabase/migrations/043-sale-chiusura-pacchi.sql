-- v1.2: FDO/sistemista possono chiudere Sala Musica (o, in linea di
-- principio, qualunque sala comune — solo Musica ha un tasto in pannello
-- per ora) per il deposito dei pacchi, senza toccare le prenotazioni già
-- fatte. Mentre è chiusa, book_space() rifiuta qualunque prenotazione
-- nuova — residente O Direzione, è lo stesso choke point (vedi
-- book_space_as_direzione, che delega a book_space()) — quindi il blocco
-- vale anche per una chiamata diretta all'RPC, non solo per l'interfaccia.
-- Consolidato in schema.sql/functions.sql/admin.sql; qui la versione da
-- applicare a un database già in produzione.

alter table room_space add column if not exists chiuso boolean not null default false;

create or replace function space_bookings(p_slug text)
returns jsonb language plpgsql stable as $$
declare
  v_sid    smallint;
  v_chiuso boolean;
  v_ws     date;
begin
  select id, chiuso into v_sid, v_chiuso from room_space where slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'sala non valida'); end if;

  v_ws := current_week_start('Europe/Rome');

  return jsonb_build_object('ok', true, 'chiuso', v_chiuso, 'bookings', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',    b.id::text,
      'day',   b.day,
      'start', b.start_min,
      'end',   b.end_min,
      'name',  b.name,
      'type',  b.btype,
      'group', b.group_id::text
    )) order by b.day, b.start_min)
    from space_booking b
    where b.space_id = v_sid and b.week_start = v_ws
  ), '[]'::jsonb));
end;
$$;

create or replace function book_space(
  p_slug  text,
  p_day   integer,
  p_start integer,
  p_end   integer,
  p_name  text,
  p_type  text default null
) returns jsonb language plpgsql as $$
declare
  v_s     room_space%rowtype;
  v_ws    date;
  v_end   int := p_end;
  v_cnt   int;
  v_name  text;
  v_type  text;
  v_gid   uuid;
  v_day2  int;
  v_ws2   date;
  v_coda  int;
begin
  select * into v_s from room_space where slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'sala non valida'); end if;

  if v_s.chiuso then
    return jsonb_build_object('ok', false, 'error', 'chiusa');
  end if;

  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('ok', false, 'error', 'nome mancante');
  end if;
  if p_day not between 0 and 6 then
    return jsonb_build_object('ok', false, 'error', 'giorno non valido');
  end if;
  if p_start is null or p_start < 0 or p_start > 1439 then
    return jsonb_build_object('ok', false, 'error', 'orario non valido');
  end if;

  if v_end <= p_start then v_end := v_end + 1440; end if;
  if v_end - p_start > 1440 then
    return jsonb_build_object('ok', false, 'error', 'durata non valida');
  end if;

  v_ws   := current_week_start('Europe/Rome');
  v_name := left(btrim(p_name), 40);
  v_type := case when v_s.has_type then p_type else null end;

  v_day2 := (p_day + 1) % 7;
  v_ws2  := case when p_day = 6 then v_ws + 7 else v_ws end;
  v_coda := v_end - 1440;

  select max(n) into v_cnt from (
    select count(*) as n
    from space_booking
    where space_id = v_s.id and week_start = v_ws and day = p_day
    union all
    select count(*)
    from space_booking
    where v_coda > 0
      and space_id = v_s.id and week_start = v_ws2 and day = v_day2
  ) t;

  if coalesce(v_cnt, 0) >= v_s.max_per_day then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  begin
    if v_coda > 0 then
      v_gid := gen_random_uuid();

      insert into space_booking (space_id, week_start, day, start_min, end_min, name, btype, group_id)
      values (v_s.id, v_ws, p_day, p_start, 1440, v_name, v_type, v_gid);

      insert into space_booking (space_id, week_start, day, start_min, end_min, name, btype, group_id)
      values (v_s.id, v_ws2, v_day2, 0, v_coda, v_name, v_type, v_gid);
    else
      insert into space_booking (space_id, week_start, day, start_min, end_min, name, btype)
      values (v_s.id, v_ws, p_day, p_start, v_end, v_name, v_type);
    end if;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'error', 'overlap');
  end;

  return space_bookings(p_slug);
end;
$$;

create or replace function admin_spaces()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(x order by x->>'space', x->>'day')
      from (
        select jsonb_build_object(
          'id', b.id, 'space', s.slug, 'day', b.day,
          'start', b.start_min, 'end', b.end_min,
          'name', b.name, 'type', b.btype
        ) as x
        from space_booking b
        join room_space s on s.id = b.space_id
        where b.week_start = current_week_start('Europe/Rome')
      ) t
    ), '[]'::jsonb),
    'sale', coalesce((
      select jsonb_agg(jsonb_build_object('slug', s.slug, 'name', s.name, 'chiuso', s.chiuso) order by s.slug)
      from room_space s
    ), '[]'::jsonb)
  );
$$;

create or replace function space_admin_set_chiuso(p_slug text, p_chiuso boolean)
returns jsonb language plpgsql as $$
begin
  update room_space set chiuso = coalesce(p_chiuso, false) where slug = p_slug;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sala non valida');
  end if;
  return jsonb_build_object('ok', true, 'slug', p_slug, 'chiuso', coalesce(p_chiuso, false));
end;
$$;

-- space_bookings/book_space/admin_spaces esistevano già: CREATE OR REPLACE
-- ne aggiorna solo il corpo, i permessi dati dal blocco di permessi.sql (una
-- tantum, alla prima installazione) restano. space_admin_set_chiuso è
-- nuova e li vuole esplicitamente, come ogni funzione aggiunta dopo quella
-- prima esecuzione (stesso motivo delle grant inline in grigliata.sql,
-- cambio-biancheria.sql, ecc.).
revoke all on function space_admin_set_chiuso(text, boolean) from public, anon, authenticated;
grant execute on function space_admin_set_chiuso(text, boolean) to service_role;
