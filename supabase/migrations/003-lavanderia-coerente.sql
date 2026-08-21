-- Una prenotazione non può attraversare le due lavanderie.
--
-- Il bug: dalla Manica si prenotava "per qualcun altro" digitando una camera
-- dal 100 in su. Il server risolve la lavanderia dalla camera PRENOTATA, quindi
-- scriveva correttamente al Valentino — ma restituiva anche lo snapshot del
-- Valentino, e il client, che stava mostrando la Manica, lo adottava. Da quel
-- momento chi era alla Manica vedeva la griglia dell'altro edificio: le proprie
-- prenotazioni sparivano dalla vista e comparivano quelle di camere che non
-- c'entravano nulla. Bastava ricaricare per rimettere a posto, ma nel frattempo
-- sembrava che i dati fossero andati persi.
--
-- Non è (solo) un problema di stato lato client: prenotare una macchina di un
-- edificio in cui non si abita non è un'operazione sensata di per sé. Le due
-- lavanderie sono fisicamente separate e servono popolazioni diverse. Quindi il
-- controllo sta qui, dove non si aggira, e non nella schermata.
--
-- p_actor_room = la camera di CHI prenota (quella dell'app), distinta da p_room
-- che è l'intestatario. Sono diverse ogni volta che si prenota per un altro, ed
-- è esattamente quel caso a produrre il bug.
--
-- Default null = nessun controllo: il client già installato sui telefoni non
-- manda questo parametro, e durante il passaggio deve continuare a funzionare
-- come prima invece di iniziare a rifiutare prenotazioni legittime.

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

  v_ws := current_week_start(v_l.tz);

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
