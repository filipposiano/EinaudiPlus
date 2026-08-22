-- 016 — La settimana della lavanderia comincia alle 07:00, non a mezzanotte.
--
-- IL PROBLEMA
--
-- Sei slot su diciannove finiscono dopo la mezzanotte: il 13 va dalle 23:15
-- alle 00:30, l'ultimo dalle 05:30 alle 06:45. Uno slot "di domenica" alle
-- 01:45 accade quindi lunedi' mattina, e li' i due orologi non erano d'accordo:
--
--   client (nowInfo, modello.ts)  prima delle 07:00 e' ancora il giorno prima
--                                 -> a lunedi' 02:00 crede sia DOMENICA
--   server (current_week_start)   date_trunc('week') e' gia' scattato
--                                 -> a lunedi' 02:00 e' la settimana NUOVA
--
-- Il client chiedeva la domenica della settimana vecchia, il server rispondeva
-- con quella nuova. Conseguenze fra le 00:00 e le 06:59 del lunedi':
--
--   - una prenotazione della domenica notte spariva dall'app mentre la
--     lavatrice stava ancora girando: la macchina risultava libera col bucato
--     di qualcuno dentro;
--   - chi prenotava in quelle ore scriveva nella settimana nuova, cioe' si
--     ritrovava il turno la domenica DOPO, sette giorni piu' tardi.
--
-- Verificato che riguarda solo quella notte: tutte le altre coincidono, perche'
-- lo sfasamento del client resta dentro la stessa settimana.
--
-- LA CURA
--
-- Non si tocca current_week_start. La usa anche apply_recurring, che gira ogni
-- notte alle 02:00 (cron.sql): spostandole il confine, di lunedi' avrebbe
-- applicato le regole ricorrenti alla settimana che stava finendo, e il lunedi'
-- sarebbe rimasto senza. Serve una nozione separata, usata solo dove si segue
-- la giornata di lavanderia.
--
-- I promemoria non erano toccati dal difetto e restano come sono: slot_start_at
-- calcola un istante assoluto, e la finestra e' gia' allargata a -7 giorni.

-- La settimana "di lavanderia": comincia il lunedi' all'ora del primo turno.
-- Sottrarre slot0_min prima di troncare sposta il confine dalle 00:00 alle
-- 07:00, che e' esattamente lo scarto che applica nowInfo() lato client.
--
-- ATTENZIONE: slot0_min qui e il 7*60 dentro nowInfo() sono lo stesso numero
-- scritto in due posti. Il client gia' fissa tutta la griglia (TIME_SLOTS,
-- 07:00 + 75 minuti), quindi se un giorno il primo turno si sposta vanno
-- cambiati insieme.
create or replace function current_laundry_week_start(p_laundry_id smallint)
returns date language sql stable as $$
  select (date_trunc('week',
            (now() at time zone l.tz) - make_interval(mins => l.slot0_min)
          ))::date
  from laundry l
  where l.id = p_laundry_id;
$$;

-- ── laundry_snapshot ──────────────────────────────────────────
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

-- ── book_laundry ──────────────────────────────────────────
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

-- ── clear_laundry ──────────────────────────────────────────
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

-- ── admin_overview ──────────────────────────────────────────
create or replace function admin_overview()
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'laundries', coalesce(jsonb_agg(x order by x->>'slug'), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'id', l.id,
      'slug', l.slug,
      'name', l.name,
      -- Il limite superiore del Valentino è una sentinella tecnica, non una
      -- regola della residenza: chi legge intende "dal 100 in su".
      'rooms', case when l.room_max >= 9999
                    then 'dal ' || l.room_min || ' in su'
                    else l.room_min || '–' || l.room_max end,
      -- Una camera qualsiasi di questa lavanderia, per le chiamate che
      -- risolvono la lavanderia dalla camera. Prima il pannello ricavava
      -- questo numero spezzando la stringa `rooms`, che è di sola
      -- visualizzazione: cambiandone il formato si sarebbe rotto in silenzio.
      'sample_room', l.room_min::text,
      'quota', l.weekly_quota,
      'reminders', l.reminder_mode,
      'week_start', current_laundry_week_start(l.id),
      'bookings', (select count(*) from laundry_booking b
                   where b.laundry_id = l.id and b.week_start = current_laundry_week_start(l.id)),
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

-- ── admin_week ──────────────────────────────────────────
create or replace function admin_week(p_laundry_id smallint, p_offset int default 0)
returns jsonb language plpgsql stable as $$
declare
  v_l  laundry%rowtype;
  v_ws date;
begin
  select * into v_l from laundry where id = p_laundry_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'lavanderia non valida'); end if;

  v_ws := current_laundry_week_start(v_l.id) + (p_offset * 7);

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

-- ── admin_force_book ──────────────────────────────────────────
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

  v_ws := current_laundry_week_start(v_l.id);

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

-- ── book_as_direzione ──────────────────────────────────────────
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

  v_ws := current_laundry_week_start(v_l.id);

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
    'week', week_snapshot(v_l.id, v_ws),
    'status', status_snapshot(v_l.id)
  );
end;
$$;

-- ── Permessi ────────────────────────────────────────────────
--
-- permessi.sql ha gia' un ALTER DEFAULT PRIVILEGES che copre le funzioni nuove,
-- ma vale la pena essere espliciti: e' l'unica riga che protegge la funzione se
-- un giorno quella migrazione venisse rieseguita in ordine diverso.
-- Le sette ridefinite mantengono i permessi che avevano: CREATE OR REPLACE non
-- azzera l'ACL.
revoke all on function current_laundry_week_start(smallint) from public, anon, authenticated;
grant execute on function current_laundry_week_start(smallint) to service_role;


-- ── Rete di sicurezza: nessuna funzione sdoppiata ───────────
--
-- CREATE OR REPLACE sostituisce una funzione solo se la firma combacia in
-- pieno. Se in produzione una di queste avesse un numero di parametri diverso
-- da quello scritto qui, non verrebbe sostituita: ne nascerebbe una SECONDA
-- accanto alla prima, e PostgREST non saprebbe piu' quale chiamare (PGRST203).
-- E' gia' successo con clear_laundry, e da fuori si vede solo un pulsante che
-- smette di funzionare. Meglio accorgersene qui, con la migrazione che si
-- rifiuta di finire, che in mano ai residenti.
do $guardia$
declare
  d text;
begin
  select string_agg(nome || ' (' || n || ' versioni)', ', ')
  into d
  from (
    select p.proname as nome, count(*) as n
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('laundry_snapshot','book_laundry','clear_laundry',
                        'admin_overview','admin_week','admin_force_book',
                        'book_as_direzione','current_laundry_week_start')
    group by p.proname
    having count(*) > 1
  ) x;

  if d is not null then
    raise exception
      'Funzioni sdoppiate dopo la migrazione: %. Cancellare la versione vecchia con DROP FUNCTION indicando la firma completa, poi rieseguire.', d;
  end if;
end
$guardia$;

-- ── Verifica ────────────────────────────────────────────────
--
-- Da eseguire a mano dopo la migrazione: mostra dove cade il confine della
-- settimana a varie ore. La colonna "coincide" deve dire si' dappertutto.
--
--   with prova(istante) as (values
--     (timestamptz '2026-08-23 23:30 Europe/Rome'),  -- domenica sera
--     (timestamptz '2026-08-24 00:30 Europe/Rome'),  -- notte dom->lun
--     (timestamptz '2026-08-24 02:00 Europe/Rome'),  -- il caso del difetto
--     (timestamptz '2026-08-24 06:59 Europe/Rome'),  -- ultimo minuto
--     (timestamptz '2026-08-24 07:00 Europe/Rome')   -- la settimana scatta qui
--   )
--   select istante,
--          (date_trunc('week', (istante at time zone 'Europe/Rome')
--                              - interval '420 minutes'))::date as settimana_lavanderia,
--          (date_trunc('week', (istante at time zone 'Europe/Rome')))::date as settimana_calendario
--   from prova;
--
-- Atteso: le prime quattro righe danno 2026-08-17, l'ultima 2026-08-24.
-- La colonna calendario invece scatta gia' alla seconda riga: e' il difetto.
