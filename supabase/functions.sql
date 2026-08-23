-- ─────────────────────────────────────────────────────────────────────────────
-- FILE CONSOLIDATO: contiene lo stato ATTUALE, non quello iniziale.
--
-- Le migrazioni in migrations/ sono gia' incorporate qui. Non vanno riapplicate
-- sopra a questo file, e questo file non va rieseguito su un database gia' in
-- produzione: le due cose insieme creerebbero doppioni di funzione (due
-- overload della stessa RPC = errore PGRST203, che PostgREST non sa risolvere).
--
-- Ordine di ricostruzione e ruolo di ciascun file: vedi README.md.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- La settimana "di lavanderia", che comincia il lunedi' all'ora del primo turno
-- invece che a mezzanotte. Vedi migrations/016 per il difetto che risolve: sei
-- slot su diciannove finiscono dopo la mezzanotte, e fra le 00:00 e le 06:59 del
-- lunedi' il client (nowInfo, che prima delle 07:00 sta ancora al giorno prima)
-- chiedeva una settimana e il server ne serviva un'altra.
--
-- Resta separata da current_week_start apposta: quella la usa apply_recurring,
-- che gira alle 02:00, e spostandole il confine di lunedi' avrebbe applicato le
-- regole ricorrenti alla settimana in scadenza.
--
-- ATTENZIONE: slot0_min qui e il 7*60 dentro nowInfo() sono lo stesso numero in
-- due posti. Se il primo turno si sposta, vanno cambiati insieme.
create or replace function current_laundry_week_start(p_laundry_id smallint)
returns date language sql stable as $$
  select (date_trunc('week',
            (now() at time zone l.tz) - make_interval(mins => l.slot0_min)
          ))::date
  from laundry l
  where l.id = p_laundry_id;
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
  v_ws := current_laundry_week_start(v_l.id);

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

-- Versione consolidata dalla migrazione 003. Vedi supabase/migrations/
-- per il perche' del cambiamento: qui c'e' solo il risultato.
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

  -- Il controllo nuovo. Si applica solo se l'app ha detto da dove sta agendo.
  -- DIREZIONE non passa di qui: la portineria usa book_as_direzione().
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

  -- `bookable = false` e `is_oos = true` sono due cose diverse:
  --  - bookable=false: la macchina non esiste fisicamente (es. W-B alla Manica).
  --    Prenotarla non ha senso, si rifiuta.
  --  - is_oos=true: la macchina c'è ma è guasta. Si può prenotare lo stesso,
  --    il client mostra un avviso.
  select * into v_m from machine where laundry_id = v_l.id and code = p_machine;
  if not found or not v_m.bookable then
    return jsonb_build_object('ok', false, 'error', 'macchina non valida');
  end if;

  v_ws := current_laundry_week_start(v_l.id);

  -- La quota settimanale NON viene applicata qui: senza autenticazione la
  -- camera è auto-dichiarata, quindi il blocco fermava solo chi la rispettava
  -- già. Resta un'indicazione lato client.

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

    -- La stringa 'occupata' è matchata da errMsg() nel client: non cambiarla.
    return jsonb_build_object('ok', false, 'error', 'occupata', 'by', v_by);
  end if;

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

-- Versione consolidata dalla migrazione 006. Vedi supabase/migrations/
-- per il perche' del cambiamento: qui c'e' solo il risultato.
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
  -- Il client attuale può chiamare senza camera: si ricade sulla lavanderia
  -- principale. Ricaduta innocua — se la prenotazione stava nell'altra, il
  -- laundry_id non combacia e la delete non tocca nulla.
  select * into v_l from laundry
  where id = coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'camera non valida');
  end if;

  v_ws := current_laundry_week_start(v_l.id);

  -- Di chi è il turno che si sta per liberare.
  select room into v_di
  from laundry_booking
  where laundry_id = v_l.id and week_start = v_ws
    and day = p_day and slot = p_slot and machine_code = p_machine;

  if v_di = 'DIREZIONE' and not p_as_admin then
    return jsonb_build_object('ok', false, 'error', 'riservata alla direzione');
  end if;

  -- Per tutto il resto resta permissiva, come prima e per le stesse ragioni.
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

-- Versione consolidata dalla migrazione 004. Vedi supabase/migrations/
-- per il perche' del cambiamento: qui c'e' solo il risultato.
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
      'type',  b.btype,
      'group', b.group_id::text
    )) order by b.day, b.start_min)
    from space_booking b
    where b.space_id = v_sid and b.week_start = v_ws
  ), '[]'::jsonb));
end;
$$;

-- Versione consolidata dalla migrazione 004. Vedi supabase/migrations/
-- per il perche' del cambiamento: qui c'e' solo il risultato.
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
  v_coda  int;
begin
  select * into v_s from room_space where slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'sala non valida'); end if;

  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('ok', false, 'error', 'nome mancante');
  end if;
  if p_day not between 0 and 6 then
    return jsonb_build_object('ok', false, 'error', 'giorno non valido');
  end if;
  if p_start is null or p_start < 0 or p_start > 1439 then
    return jsonb_build_object('ok', false, 'error', 'orario non valido');
  end if;

  -- Semantica di parseRange_: una fascia che scavalca la mezzanotte arriva con
  -- end <= start e si riporta a end + 1440.
  if v_end <= p_start then v_end := v_end + 1440; end if;
  if v_end - p_start > 1440 then
    return jsonb_build_object('ok', false, 'error', 'durata non valida');
  end if;

  v_ws   := current_week_start('Europe/Rome');
  v_name := left(btrim(p_name), 40);
  v_type := case when v_s.has_type then p_type else null end;

  -- Il giorno dopo, con la domenica che rientra sul lunedì della stessa
  -- settimana: la griglia è settimanale e non ha un "giorno 7" dove mettere le
  -- ore piccole della notte fra domenica e lunedì.
  v_day2 := (p_day + 1) % 7;
  v_coda := v_end - 1440;   -- > 0 solo se si scavalca

  -- Il tetto giornaliero va verificato su TUTTI i giorni che la prenotazione
  -- tocca, non solo su quello di partenza.
  select count(*) into v_cnt
  from space_booking
  where space_id = v_s.id and week_start = v_ws
    and day = any(case when v_coda > 0 then array[p_day, v_day2] else array[p_day] end)
  group by day
  order by count(*) desc
  limit 1;

  if coalesce(v_cnt, 0) >= v_s.max_per_day then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  begin
    if v_coda > 0 then
      v_gid := gen_random_uuid();

      -- Testa: dall'inizio fino a mezzanotte.
      insert into space_booking (space_id, week_start, day, start_min, end_min, name, btype, group_id)
      values (v_s.id, v_ws, p_day, p_start, 1440, v_name, v_type, v_gid);

      -- Coda: da mezzanotte alla fine, sul giorno successivo. È questa riga a
      -- rendere la notte visibile al vincolo anti-sovrapposizione del giorno
      -- dopo — il motivo per cui esiste la divisione.
      insert into space_booking (space_id, week_start, day, start_min, end_min, name, btype, group_id)
      values (v_s.id, v_ws, v_day2, 0, v_coda, v_name, v_type, v_gid);
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

-- Versione consolidata dalla migrazione 004. Vedi supabase/migrations/
-- per il perche' del cambiamento: qui c'e' solo il risultato.
create or replace function delete_space_booking(p_slug text, p_id text)
returns jsonb language plpgsql as $$
declare
  v_sid smallint;
  v_bid bigint;
  v_gid uuid;
begin
  select id into v_sid from room_space where slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'sala non valida'); end if;

  v_bid := nullif(regexp_replace(p_id, '\D', '', 'g'), '')::bigint;

  select group_id into v_gid
  from space_booking where space_id = v_sid and id = v_bid;

  if v_gid is not null then
    delete from space_booking where space_id = v_sid and group_id = v_gid;
  else
    delete from space_booking where space_id = v_sid and id = v_bid;
  end if;

  return space_bookings(p_slug);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Iscrizioni push e segnalazioni
-- ─────────────────────────────────────────────────────────────────────────────

-- Versione consolidata dalla migrazione 017: c'e' un tetto di sei iscrizioni
-- per camera. Non impedisce a un estraneo di attaccarsi a una camera che non e'
-- la sua — senza account per i residenti non e' possibile, e la griglia della
-- settimana e' comunque pubblica — ma impedisce che UNO solo ne registri
-- centinaia e faccia esplodere il fan-out di /api/cron. Il perche' dei dettagli
-- (sei, potatura a 90 giorni, rifiuto invece di sfratto) sta nella migrazione.
create or replace function upsert_push_sub(
  p_room text, p_endpoint text, p_p256dh text, p_auth text
) returns jsonb language plpgsql as $$
declare
  v_id   smallint;
  v_old  text;
  v_n    int;
  c_max  constant int := 6;
begin
  if p_endpoint is null or p_endpoint = '' then
    return jsonb_build_object('ok', false, 'error', 'subscription mancante');
  end if;

  v_id := coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));

  -- Dispositivi spariti: l'app non si apre da tre mesi su quell'endpoint.
  -- refreshSubscription() rinfresca last_seen a ogni avvio, quindi qui cade
  -- solo cio' che non c'e' piu' davvero.
  delete from push_sub
  where laundry_id = v_id
    and room = p_room
    and endpoint <> p_endpoint
    and last_seen < now() - interval '90 days';

  select room into v_old from push_sub where endpoint = p_endpoint;

  -- Il tetto vale per le iscrizioni NUOVE su questa camera: il rinnovo di un
  -- endpoint che gia' le appartiene non deve mai fallire.
  if v_old is distinct from p_room then
    select count(*) into v_n from push_sub where laundry_id = v_id and room = p_room;
    if v_n >= c_max then
      return jsonb_build_object(
        'ok', false,
        'error', 'troppi dispositivi collegati a questa camera: disattiva le notifiche su uno di quelli vecchi, oppure chiedi in portineria'
      );
    end if;
  end if;

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
