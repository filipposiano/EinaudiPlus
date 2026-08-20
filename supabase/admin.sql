-- Funzioni per il pannello amministrativo.
--
-- Separate dalle funzioni pubbliche perche' fanno cose che ai residenti non
-- sono permesse: scavalcare la quota, cancellare prenotazioni altrui, cambiare
-- lo stato delle macchine. L'autorizzazione si applica a monte, in /api/admin:
-- queste non vengono mai raggiunte da /api/laundry.

-- Panoramica: lavanderie, macchine e quanto e' occupata la settimana.
create or replace function admin_overview()
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'laundries', coalesce(jsonb_agg(x order by x->>'slug'), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'id', l.id,
      'slug', l.slug,
      'name', l.name,
      'rooms', l.room_min || '–' || l.room_max,
      'quota', l.weekly_quota,
      'reminders', l.reminder_mode,
      'week_start', current_week_start(l.tz),
      'bookings', (select count(*) from laundry_booking b
                   where b.laundry_id = l.id and b.week_start = current_week_start(l.tz)),
      'machines', (
        select jsonb_agg(jsonb_build_object(
          'code', m.code, 'kind', m.kind,
          'oos', m.is_oos, 'bookable', m.bookable,
          'updated_at', m.updated_at
        ) order by m.sort_order)
        from machine m where m.laundry_id = l.id
      )
    ) as x
    from laundry l
  ) s;
$$;

-- La griglia di una settimana, con gli id delle prenotazioni: servono per
-- cancellarle una per una dal pannello.
create or replace function admin_week(p_laundry_id smallint, p_offset int default 0)
returns jsonb language plpgsql stable as $$
declare
  v_l  laundry%rowtype;
  v_ws date;
begin
  select * into v_l from laundry where id = p_laundry_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'lavanderia non valida'); end if;

  v_ws := current_week_start(v_l.tz) + (p_offset * 7);

  return jsonb_build_object(
    'ok', true,
    'week_start', v_ws,
    'offset', p_offset,
    'n_slots', v_l.n_slots,
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'day', b.day, 'slot', b.slot,
        'machine', b.machine_code, 'room', b.room,
        'by', b.created_by, 'at', b.created_at
      ) order by b.day, b.slot, b.machine_code)
      from laundry_booking b
      where b.laundry_id = v_l.id and b.week_start = v_ws
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function admin_delete_booking(p_id bigint)
returns jsonb language plpgsql as $$
declare v_n int;
begin
  delete from laundry_booking where id = p_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0, 'error', case when v_n = 0 then 'prenotazione inesistente' end);
end;
$$;

-- Prenota per conto di una camera, scavalcando la quota settimanale.
-- Serve per i casi che si risolvono a voce in portineria.
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

  v_ws := current_week_start(v_l.tz);

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

-- Le segnalazioni. Sono il canale con cui i residenti dicono che una macchina
-- e' rotta, da quando il fuori servizio e' passato agli admin.
create or replace function admin_feedback(p_only_open boolean default true, p_limit int default 100)
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'items', coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'id', f.id,
      'room', f.room,
      'body', f.body,
      'laundry', l.slug,
      'created_at', f.created_at,
      'handled', f.handled_at is not null
    ) as x
    from feedback f
    left join laundry l on l.id = f.laundry_id
    where (not p_only_open) or f.handled_at is null
    order by f.created_at desc
    limit p_limit
  ) s;
$$;

create or replace function admin_mark_feedback(p_id bigint, p_handled boolean default true)
returns jsonb language plpgsql as $$
begin
  update feedback set handled_at = case when p_handled then now() else null end where id = p_id;
  return jsonb_build_object('ok', found);
end;
$$;

create or replace function admin_delete_space_booking(p_id bigint)
returns jsonb language plpgsql as $$
declare v_n int;
begin
  delete from space_booking where id = p_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0);
end;
$$;

-- Tutte le prenotazioni sale della settimana, entrambe le sale insieme.
create or replace function admin_spaces()
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'items', coalesce(jsonb_agg(x order by x->>'space', x->>'day'), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'id', b.id, 'space', s.slug, 'day', b.day,
      'start', b.start_min, 'end', b.end_min,
      'name', b.name, 'type', b.btype
    ) as x
    from space_booking b
    join room_space s on s.id = b.space_id
    where b.week_start = current_week_start('Europe/Rome')
  ) t;
$$;

create or replace function admin_log(p_actor text, p_action text, p_detail jsonb default null)
returns void language sql as $$
  insert into audit_log (actor, action, detail) values (p_actor, p_action, p_detail);
$$;
