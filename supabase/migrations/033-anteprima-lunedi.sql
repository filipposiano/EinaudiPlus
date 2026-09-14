-- Anteprima del lunedì della settimana prossima, dal sabato sera.
--
-- Prima: la settimana "gira" per la lavanderia esattamente quando gira
-- current_laundry_week_start — cioè al confine naturale delle 07:00 di
-- lunedì (vedi migrations/016). Fino a un attimo prima, il lunedì che si
-- vede in griglia è quello della settimana che sta per finire: un giorno
-- ormai passato, di cui non resta niente da fare.
--
-- Ora, da sabato alle 20:00 fino al confine delle 07:00 di lunedì (tutta la
-- domenica compresa), SOLO il giorno 0 (lunedì) smette di puntare alla
-- settimana corrente e punta a quella dopo: il lunedì che si vede — e si
-- prenota — è già quello nuovo. Gli altri sei giorni non si toccano: non
-- sono affari loro, e restano ancorati alla settimana vera finché non è
-- davvero finita.
--
-- Questo NON è un secondo confine di settimana concorrente: current_laundry_
-- week_start resta l'unica fonte della settimana "corrente", usata da tutto
-- il resto. laundry_week_start_for_day() la avvolge e la corregge di un
-- giorno solo, di sette giorni soli, in una finestra sola — dove la
-- correzione conta.

-- Sabato dalle 20:00, tutta la domenica, lunedì fino alle 07:00: la stessa
-- finestra, e lo stesso confine finale, di current_laundry_week_start. Prima
-- delle 20:00 di sabato il lunedì prossimo non è ancora "prossimo abbastanza"
-- da meritare l'anteprima; dopo le 07:00 di lunedì la settimana è già
-- girata da sola, e l'anteprima non serve più.
create or replace function laundry_preview_active(p_tz text default 'Europe/Rome')
returns boolean language sql stable as $$
  select case extract(isodow from now() at time zone p_tz)::int
    when 6 then (now() at time zone p_tz)::time >= time '20:00'  -- sabato sera
    when 7 then true                                              -- domenica, tutta
    when 1 then (now() at time zone p_tz)::time <  time '07:00'   -- lunedì presto
    else false
  end;
$$;

-- La settimana su cui scrivere/leggere UN giorno preciso. Uguale a
-- current_laundry_week_start per i giorni 1-6 sempre, e per il giorno 0
-- fuori dalla finestra di anteprima; durante l'anteprima il giorno 0 punta
-- a +7: la settimana che sta per cominciare.
create or replace function laundry_week_start_for_day(p_laundry_id smallint, p_day integer)
returns date language sql stable as $$
  select current_laundry_week_start(p_laundry_id)
       + case when p_day = 0 and laundry_preview_active() then 7 else 0 end;
$$;

-- Come week_snapshot, ma ogni giorno legge dalla SUA settimana invece che da
-- una sola passata da fuori — è quello che serve per mescolare, nella stessa
-- risposta, sei giorni della settimana corrente e un lunedì che durante
-- l'anteprima appartiene già alla prossima. week_snapshot originale non si
-- tocca: resta quella che usa admin_overview, dove non c'entra.
create or replace function week_snapshot_mixed(p_laundry_id smallint)
returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(d::text, coalesce(l.day_obj, '{}'::jsonb)), '{}'::jsonb)
  from generate_series(0, 6) as d
  left join lateral (
    select jsonb_object_agg(s.slot::text, s.machines) as day_obj
    from (
      select b.slot, jsonb_object_agg(b.machine_code, b.room) as machines
      from laundry_booking b
      where b.laundry_id = p_laundry_id
        and b.week_start = laundry_week_start_for_day(p_laundry_id, d)
        and b.day = d
      group by b.slot
    ) s
  ) l on true;
$$;

-- Le tre funzioni che residente e admin-che-agisce-come-residente chiamano
-- per leggere/scrivere un turno: usano da qui in poi la settimana per-giorno
-- invece della settimana unica.

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
    'tema',   app_theme_get()
  );
end;
$$;

create or replace function book_laundry(
  p_room       text,
  p_day        integer,
  p_slot       integer,
  p_machine    text,
  p_as_admin   boolean default false,
  p_actor_room text default null
) returns jsonb language plpgsql as $$
declare
  v_l     laundry%rowtype;
  v_m     machine%rowtype;
  v_ws    date;
  v_id    bigint;
  v_by    text;
  v_actor smallint;
begin
  if p_room is null or p_room !~ '^[0-9]{1,4}(-?[abAB])?$' then
    return jsonb_build_object('ok', false, 'error', 'camera mancante');
  end if;

  select * into v_l from laundry where id = laundry_for_room(p_room);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'camera non valida');
  end if;

  if p_actor_room is not null and p_actor_room <> '' and p_actor_room <> 'DIREZIONE' then
    v_actor := laundry_for_room(p_actor_room);
    if v_actor is not null and v_actor <> v_l.id then
      return jsonb_build_object(
        'ok', false,
        'error', 'altra lavanderia',
        'lavanderia', v_l.name
      );
    end if;
  end if;

  if p_day not between 0 and 6 or p_slot not between 0 and v_l.n_slots - 1 then
    return jsonb_build_object('ok', false, 'error', 'parametri non validi');
  end if;

  select * into v_m from machine where laundry_id = v_l.id and code = p_machine;
  if not found or not v_m.bookable then
    return jsonb_build_object('ok', false, 'error', 'macchina non valida');
  end if;

  v_ws := laundry_week_start_for_day(v_l.id, p_day);

  insert into laundry_booking (laundry_id, week_start, day, slot, machine_code, room, created_by)
  values (v_l.id, v_ws, p_day, p_slot, p_machine, p_room,
          case when p_as_admin then 'admin' else 'user' end)
  on conflict (laundry_id, week_start, day, slot, machine_code) do nothing
  returning id into v_id;

  if v_id is null then
    select room into v_by
    from laundry_booking
    where laundry_id = v_l.id and week_start = v_ws
      and day = p_day and slot = p_slot and machine_code = p_machine;

    return jsonb_build_object('ok', false, 'error', 'occupata', 'by', v_by);
  end if;

  return jsonb_build_object(
    'ok', true,
    'week', week_snapshot_mixed(v_l.id),
    'status', status_snapshot(v_l.id)
  ) || case when v_m.is_oos
            then jsonb_build_object('warning', 'oos')
            else '{}'::jsonb
       end;
end;
$$;

create or replace function clear_laundry(
  p_room     text,
  p_day      integer,
  p_slot     integer,
  p_machine  text,
  p_as_admin boolean default false
) returns jsonb language plpgsql as $$
declare
  v_l  laundry%rowtype;
  v_ws date;
  v_di text;
begin
  select * into v_l from laundry
  where id = coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'camera non valida');
  end if;

  v_ws := laundry_week_start_for_day(v_l.id, p_day);

  select room into v_di
  from laundry_booking
  where laundry_id = v_l.id and week_start = v_ws
    and day = p_day and slot = p_slot and machine_code = p_machine;

  if v_di = 'DIREZIONE' and not p_as_admin then
    return jsonb_build_object('ok', false, 'error', 'riservata alla direzione');
  end if;

  delete from laundry_booking
  where laundry_id = v_l.id and week_start = v_ws
    and day = p_day and slot = p_slot and machine_code = p_machine;

  return jsonb_build_object('ok', true,
    'week', week_snapshot_mixed(v_l.id), 'status', status_snapshot(v_l.id));
end;
$$;

-- Due percorsi amministrativi scrivono nella stessa tabella con lo stesso
-- significato di giorno/settimana, e devono risolvere il giorno 0 allo
-- stesso modo dei residenti — altrimenti la DIREZIONE (o un forceBook da
-- portineria) scriverebbe sul lunedì sbagliato rispetto a quello che la
-- griglia sta già mostrando.

create or replace function book_as_direzione(
  p_laundry_id smallint, p_day int, p_slot int, p_machine text
) returns jsonb language plpgsql as $$
declare
  v_l  laundry%rowtype;
  v_ws date;
  v_id bigint;
  v_by text;
begin
  select * into v_l from laundry where id = p_laundry_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'lavanderia non valida');
  end if;

  if p_day not between 0 and 6 or p_slot not between 0 and v_l.n_slots - 1 then
    return jsonb_build_object('ok', false, 'error', 'parametri non validi');
  end if;

  if not exists (
    select 1 from machine
    where laundry_id = v_l.id and code = p_machine and bookable
  ) then
    return jsonb_build_object('ok', false, 'error', 'macchina non valida');
  end if;

  v_ws := laundry_week_start_for_day(v_l.id, p_day);

  insert into laundry_booking (laundry_id, week_start, day, slot, machine_code, room, created_by)
  values (v_l.id, v_ws, p_day, p_slot, p_machine, 'DIREZIONE', 'admin')
  on conflict (laundry_id, week_start, day, slot, machine_code) do nothing
  returning id into v_id;

  if v_id is null then
    select room into v_by from laundry_booking
    where laundry_id = v_l.id and week_start = v_ws
      and day = p_day and slot = p_slot and machine_code = p_machine;
    return jsonb_build_object('ok', false, 'error', 'occupata', 'by', v_by);
  end if;

  return jsonb_build_object(
    'ok', true,
    'week', week_snapshot_mixed(v_l.id),
    'status', status_snapshot(v_l.id)
  );
end;
$$;

create or replace function admin_force_book(
  p_laundry_id smallint, p_day int, p_slot int, p_machine text, p_room text
) returns jsonb language plpgsql as $$
declare
  v_l  laundry%rowtype;
  v_ws date;
  v_id bigint;
  v_by text;
begin
  select * into v_l from laundry where id = p_laundry_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'lavanderia non valida'); end if;

  v_ws := laundry_week_start_for_day(v_l.id, p_day);

  insert into laundry_booking (laundry_id, week_start, day, slot, machine_code, room, created_by)
  values (v_l.id, v_ws, p_day, p_slot, p_machine, p_room, 'admin')
  on conflict (laundry_id, week_start, day, slot, machine_code) do nothing
  returning id into v_id;

  if v_id is null then
    select room into v_by from laundry_booking
    where laundry_id = v_l.id and week_start = v_ws
      and day = p_day and slot = p_slot and machine_code = p_machine;
    return jsonb_build_object('ok', false, 'error', 'occupata', 'by', v_by);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
