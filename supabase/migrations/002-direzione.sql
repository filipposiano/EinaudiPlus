-- Prenotazioni a nome della DIREZIONE.
--
-- L'amministratore deve poter riservare un turno che non appartiene a nessuna
-- camera: manutenzione, lavaggi di servizio, turni tenuti liberi apposta.
-- Finora il vincolo sul formato camera lo impediva, perche' accetta solo cifre.
--
-- 'DIREZIONE' e' l'unica eccezione ammessa, in maiuscolo: non puo' collidere
-- con un numero di camera e si distingue a colpo d'occhio nella griglia.

-- ─────────────────────────────────────────────────────────────────────────────
-- Vincolo sulle prenotazioni
-- ─────────────────────────────────────────────────────────────────────────────

alter table laundry_booking drop constraint if exists laundry_booking_room_check;
alter table laundry_booking add  constraint laundry_booking_room_check
  check (room = 'DIREZIONE' or room ~ '^[0-9]{1,4}(-?[abAB])?$');

-- Stesso discorso per le regole ricorrenti: una riserva fissa della direzione
-- (es. ogni lunedi' mattina per la manutenzione) deve essere esprimibile.
alter table recurring_booking drop constraint if exists recurring_booking_room_check;
alter table recurring_booking add  constraint recurring_booking_room_check
  check (room is null or room = 'DIREZIONE' or room ~ '^[0-9]{1,4}(-?[abAB])?$');

-- ─────────────────────────────────────────────────────────────────────────────
-- Prenotazione a nome DIREZIONE
--
-- Funzione separata da book_laundry perche' il percorso e' diverso: qui la
-- lavanderia non si deduce dalla camera (DIREZIONE non ha un numero), va detta
-- esplicitamente. L'autorizzazione si applica in /api/admin.
-- ─────────────────────────────────────────────────────────────────────────────

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

  v_ws := current_week_start(v_l.tz);

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

-- Non serve una funzione di cancellazione amministrativa: clear_laundry e'
-- gia' permissiva per chiunque (nessun controllo di proprieta', scelta
-- deliberata in assenza di autenticazione), quindi vale anche per l'admin.

-- Prenota una sala a nome della direzione. Per le sale il nome e' testo
-- libero, quindi non serviva allentare nessun vincolo.
create or replace function book_space_as_direzione(
  p_slug text, p_day int, p_start int, p_end int, p_type text default null
) returns jsonb language sql as $$
  select book_space(p_slug, p_day, p_start, p_end, 'DIREZIONE', p_type);
$$;
