-- EinaudiPlus — funzioni applicative
--
-- Ogni mutazione passa da qui, mai da SQL sparso nelle funzioni serverless.
-- Motivo: prenotare deve essere UNA transazione atomica. Il controllo "è libero?"
-- e la scrittura devono stare insieme, altrimenti si ricrea la race condition che
-- Apps Script tamponava con LockService.waitLock(15000).
--
-- Le funzioni tornano jsonb già nella forma che il frontend si aspetta, così le
-- funzioni serverless non rimappano nulla e non c'è un secondo posto dove il
-- contratto può divergere.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper
-- ─────────────────────────────────────────────────────────────────────────────

-- Il lunedì della settimana corrente, nel fuso della lavanderia.
-- Sostituisce mondayBase_() e il suo bug: quello faceva base + day*86400000,
-- che nei due giorni di cambio ora legale sbaglia di un'ora ogni slot.
create or replace function current_week_start(p_tz text default 'Europe/Rome')
returns date language sql stable as $$
  select (date_trunc('week', now() at time zone p_tz))::date;
$$;

-- Sostituisce getApiUrl() lato client, che leggeva localStorage a ogni chiamata:
-- cambiando camera senza ricaricare si poteva leggere una lavanderia e scrivere
-- sull'altra. Ora la decisione è una sola, server-side.
create or replace function laundry_for_room(p_room text)
returns smallint language sql stable as $$
  select l.id
  from laundry l
  where nullif(substring(p_room from '^[0-9]+'), '')::int between l.room_min and l.room_max
  order by l.room_min
  limit 1;
$$;

-- Istante d'inizio di uno slot, come timestamptz. Il "at time zone" è ciò che
-- rende i promemoria corretti anche nei giorni di cambio ora.
create or replace function slot_start_at(p_laundry_id smallint, p_week_start date, p_day int, p_slot int)
returns timestamptz language sql stable as $$
  select ((p_week_start + p_day)::timestamp
          + make_interval(mins => l.slot0_min + p_slot * l.slot_len_min))
         at time zone l.tz
  from laundry l where l.id = p_laundry_id;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Letture — producono esattamente le forme che il client indicizza oggi
-- ─────────────────────────────────────────────────────────────────────────────

-- week[day][slot][machine] = room
-- Tutte e 7 le chiavi giorno sono sempre presenti (anche vuote), come fa getWeek_.
create or replace function week_snapshot(p_laundry_id smallint, p_week_start date)
returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(d::text, coalesce(l.day_obj, '{}'::jsonb)), '{}'::jsonb)
  from generate_series(0, 6) as d
  left join lateral (
    select jsonb_object_agg(s.slot::text, s.machines) as day_obj
    from (
      select b.slot, jsonb_object_agg(b.machine_code, b.room) as machines
      from laundry_booking b
      where b.laundry_id = p_laundry_id
        and b.week_start = p_week_start
        and b.day = d
      group by b.slot
    ) s
  ) l on true;
$$;

-- status[machine] = 'ok' | 'oos', tutte e sei le sigle sempre presenti.
create or replace function status_snapshot(p_laundry_id smallint)
returns jsonb language sql stable as $$
  select coalesce(
    jsonb_object_agg(code, case when is_oos then 'oos' else 'ok' end),
    '{}'::jsonb)
  from machine
  where laundry_id = p_laundry_id;
$$;

-- La risposta completa: {ok, week, status, slots}
create or replace function laundry_snapshot(p_room text default null)
returns jsonb language plpgsql stable as $$
declare
  v_id smallint;
  v_l  laundry%rowtype;
  v_ws date;
begin
  -- Fallback su 'valentino' come faceva getApiUrl() con "return API_URL"
  v_id := coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));
  select * into v_l from laundry where id = v_id;
  v_ws := current_week_start(v_l.tz);

  return jsonb_build_object(
    'ok',     true,
    'week',   week_snapshot(v_id, v_ws),
    'status', status_snapshot(v_id),
    'slots',  v_l.n_slots
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Scritture lavanderia
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function book_laundry(
  p_room text, p_day int, p_slot int, p_machine text, p_as_admin boolean default false
) returns jsonb language plpgsql as $$
declare
  v_l     laundry%rowtype;
  v_m     machine%rowtype;
  v_ws    date;
  v_used  int;
  v_id    bigint;
  v_by    text;
begin
  if p_room is null or p_room !~ '^[0-9]{1,4}(-?[abAB])?$' then
    return jsonb_build_object('ok', false, 'error', 'camera mancante');
  end if;

  select * into v_l from laundry where id = laundry_for_room(p_room);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'camera non valida');
  end if;

  if p_day not between 0 and 6 or p_slot not between 0 and v_l.n_slots - 1 then
    return jsonb_build_object('ok', false, 'error', 'parametri non validi');
  end if;

  -- `bookable = false` e `is_oos = true` sono due cose diverse:
  --  - bookable=false: la macchina non esiste fisicamente (es. W-B in sezione).
  --    Prenotarla non ha senso, si rifiuta.
  --  - is_oos=true: la macchina c'è ma è guasta. Si può prenotare lo stesso,
  --    il client mostra un avviso. Serve a non bloccare chi vuole mettersi in
  --    coda per quando sarà riparata, e a non perdere lo slot nel frattempo.
  select * into v_m from machine where laundry_id = v_l.id and code = p_machine;
  if not found or not v_m.bookable then
    return jsonb_build_object('ok', false, 'error', 'macchina non valida');
  end if;

  v_ws := current_week_start(v_l.tz);

  -- Quota settimanale: era solo lato client (LaundryView), quindi aggirabile.
  if not p_as_admin then
    select count(*) into v_used
    from laundry_booking
    where laundry_id = v_l.id and week_start = v_ws and room = p_room;

    if v_used >= v_l.weekly_quota then
      return jsonb_build_object('ok', false, 'error', 'quota', 'limit', v_l.weekly_quota);
    end if;
  end if;

  -- Il cuore: insert atomica. Se lo slot è già preso il vincolo unique blocca,
  -- ON CONFLICT DO NOTHING non restituisce nulla e sappiamo di aver perso la corsa.
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

    -- La stringa 'occupata' è matchata da errMsg() nel client per localizzare
    -- il messaggio: non cambiarla. La vecchia new-laundry mandava invece
    -- 'Turno già occupato', che infatti sfuggiva alla traduzione.
    return jsonb_build_object('ok', false, 'error', 'occupata', 'by', v_by);
  end if;

  -- Prenotazione riuscita su macchina guasta: il client usa `warning` per
  -- mostrare l'avviso, ma la prenotazione è valida a tutti gli effetti.
  return jsonb_build_object(
    'ok', true,
    'week', week_snapshot(v_l.id, v_ws),
    'status', status_snapshot(v_l.id)
  ) || case when v_m.is_oos
            then jsonb_build_object('warning', 'oos')
            else '{}'::jsonb
       end;
end;
$$;

create or replace function clear_laundry(
  p_room text, p_day int, p_slot int, p_machine text
) returns jsonb language plpgsql as $$
declare
  v_l  laundry%rowtype;
  v_ws date;
begin
  -- Il client attuale chiama clearBooking(day, slot, machine) SENZA camera:
  -- si ricade sulla lavanderia principale finche' la fase 5 non la aggiunge.
  -- Ricaduta innocua: se la prenotazione stava nell'altra lavanderia il
  -- laundry_id non combacia e la delete non tocca nulla.
  select * into v_l from laundry
  where id = coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'camera non valida');
  end if;

  v_ws := current_week_start(v_l.tz);

  -- Cancellazione permissiva, come oggi: chiunque può liberare qualunque slot.
  --
  -- Deliberato, non una svista. L'app non ha login: la camera è auto-dichiarata
  -- in localStorage e chiunque può scriverci il numero che vuole. Un controllo
  -- di proprietà non proteggerebbe niente, si aggirerebbe cambiando una stringa
  -- nel browser — aggiungerebbe solo attrito per chi usa l'app onestamente.
  -- Se un domani arrivasse un'autenticazione vera, è qui che andrebbe il controllo.
  --
  -- p_room serve comunque, per sapere di quale lavanderia si parla.
  delete from laundry_booking
  where laundry_id = v_l.id and week_start = v_ws
    and day = p_day and slot = p_slot and machine_code = p_machine;

  return jsonb_build_object('ok', true,
    'week', week_snapshot(v_l.id, v_ws), 'status', status_snapshot(v_l.id));
end;
$$;

-- SOLO ADMIN. L'autorizzazione si applica a monte, nelle funzioni serverless:
-- questa è raggiungibile unicamente da /api/admin, mai da /api/laundry.
-- Prima era esposta a chiunque tramite l'AdminSheet dentro l'app — anche se in
-- pratica non funzionava, perché il client mandava action 'status' con
-- {status:'oos'} mentre il backend si aspettava 'setStatus' con {oos:true}:
-- nessun ramo combaciava e si finiva su 'azione sconosciuta'.
--
-- Segnare una macchina fuori servizio NON impedisce di prenotarla: rende solo
-- lo stato visibile, e book_laundry risponde con warning='oos'.
create or replace function set_machine_status(
  p_room text, p_machine text, p_oos boolean
) returns jsonb language plpgsql as $$
declare
  v_id smallint;
begin
  v_id := coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));

  update machine
  set is_oos = p_oos, updated_at = now()
  where laundry_id = v_id and code = p_machine and bookable = true;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'macchina non valida');
  end if;

  return jsonb_build_object('ok', true, 'status', status_snapshot(v_id));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sale cinema e musica
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function space_bookings(p_slug text)
returns jsonb language plpgsql stable as $$
declare
  v_sid smallint;
  v_ws  date;
begin
  select id into v_sid from room_space where slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'sala non valida'); end if;

  v_ws := current_week_start('Europe/Rome');

  return jsonb_build_object('ok', true, 'bookings', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',    b.id::text,
      'day',   b.day,
      'start', b.start_min,
      'end',   b.end_min,
      'name',  b.name,
      'type',  b.btype
    )) order by b.day, b.start_min)
    from space_booking b
    where b.space_id = v_sid and b.week_start = v_ws
  ), '[]'::jsonb));
end;
$$;

create or replace function book_space(
  p_slug text, p_day int, p_start int, p_end int, p_name text, p_type text default null
) returns jsonb language plpgsql as $$
declare
  v_s   room_space%rowtype;
  v_ws  date;
  v_end int := p_end;
  v_cnt int;
begin
  select * into v_s from room_space where slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'sala non valida'); end if;

  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('ok', false, 'error', 'nome mancante');
  end if;
  if p_day not between 0 and 6 then
    return jsonb_build_object('ok', false, 'error', 'giorno non valido');
  end if;

  -- Conserva la semantica di parseRange_: un turno che scavalca mezzanotte
  -- ha end <= start, e si porta a end + 1440.
  if v_end <= p_start then v_end := v_end + 1440; end if;
  if v_end - p_start > 1440 then
    return jsonb_build_object('ok', false, 'error', 'durata non valida');
  end if;

  v_ws := current_week_start('Europe/Rome');

  select count(*) into v_cnt
  from space_booking
  where space_id = v_s.id and week_start = v_ws and day = p_day;

  if v_cnt >= v_s.max_per_day then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  begin
    insert into space_booking (space_id, week_start, day, start_min, end_min, name, btype)
    values (v_s.id, v_ws, p_day, p_start, v_end, left(btrim(p_name), 40),
            case when v_s.has_type then p_type else null end);
  exception
    -- Sollevata dall'exclude constraint: due turni che si accavallano non possono
    -- coesistere, punto. Sostituisce il controllo read-then-write di Code.gs.
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'error', 'overlap');
  end;

  return space_bookings(p_slug);
end;
$$;

create or replace function delete_space_booking(p_slug text, p_id text)
returns jsonb language plpgsql as $$
declare
  v_sid smallint;
begin
  select id into v_sid from room_space where slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'sala non valida'); end if;

  delete from space_booking
  where space_id = v_sid and id = nullif(regexp_replace(p_id, '\D', '', 'g'), '')::bigint;

  return space_bookings(p_slug);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Iscrizioni push e segnalazioni
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function upsert_push_sub(
  p_room text, p_endpoint text, p_p256dh text, p_auth text
) returns jsonb language plpgsql as $$
declare
  v_id smallint;
begin
  if p_endpoint is null or p_endpoint = '' then
    return jsonb_build_object('ok', false, 'error', 'subscription mancante');
  end if;

  v_id := coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));

  insert into push_sub (endpoint, p256dh, auth, room, laundry_id)
  values (p_endpoint, p_p256dh, p_auth, p_room, v_id)
  on conflict (endpoint) do update
    set room = excluded.room,
        laundry_id = excluded.laundry_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        last_seen = now(),
        fail_count = 0;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function remove_push_sub(p_endpoint text)
returns jsonb language plpgsql as $$
begin
  delete from push_sub where endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function add_feedback(p_room text, p_text text)
returns jsonb language plpgsql as $$
declare
  v_body text := left(btrim(coalesce(p_text, '')), 2000);
begin
  if v_body = '' then
    return jsonb_build_object('ok', false, 'error', 'feedback vuoto');
  end if;

  insert into feedback (laundry_id, room, body)
  values (laundry_for_room(p_room), nullif(btrim(coalesce(p_room, '')), ''), v_body);

  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rate limit — finestra scorrevole grossolana, sufficiente contro gli abusi
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function rl_hit(p_bucket text, p_limit int, p_window_secs int)
returns boolean language plpgsql as $$
declare
  v_hits int;
begin
  insert into rate_limit (bucket, hits, window_start)
  values (p_bucket, 1, now())
  on conflict (bucket) do update
    set hits = case
          when rate_limit.window_start < now() - make_interval(secs => p_window_secs) then 1
          else rate_limit.hits + 1
        end,
        window_start = case
          when rate_limit.window_start < now() - make_interval(secs => p_window_secs) then now()
          else rate_limit.window_start
        end
  returning hits into v_hits;

  return v_hits <= p_limit;   -- false = superato il limite
end;
$$;
