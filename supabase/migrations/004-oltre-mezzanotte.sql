-- Prenotazioni sale che scavalcano la mezzanotte.
--
-- Prima una fascia 21:00→01:00 si salvava come UNA riga sul giorno di partenza,
-- con end_min = 1500 (cioè 25:00). Funzionava per la lettura — la timeline sa
-- già disegnare oltre le 24:00 — ma lasciava aperto un buco vero:
--
--   il vincolo che impedisce le sovrapposizioni è
--     exclude (space_id =, week_start =, day =, int4range(start_min, end_min) &&)
--   cioè lavora DENTRO un giorno. La riga di giovedì 1260→1500 e una riga di
--   venerdì 0→60 hanno `day` diverso, quindi il vincolo non le confronta mai:
--   due persone potevano prenotare la stessa ora della stessa notte, e il
--   database lo accettava senza fiatare.
--
-- Qui la prenotazione notturna diventa DUE righe — giovedì 21:00→24:00 e
-- venerdì 00:00→01:00 — legate da group_id. Così il vincolo che esiste già fa
-- il lavoro giusto su entrambi i giorni, senza doverne inventare uno nuovo che
-- ragioni sul tempo assoluto della settimana.
--
-- Le due righe nascono e muoiono insieme: sono inserite nella stessa funzione,
-- quindi nella stessa transazione (se la seconda sbatte contro il vincolo,
-- rollback di tutte e due e l'utente vede "overlap"), e delete_space_booking
-- cancella per group_id.

alter table space_booking add column if not exists group_id uuid;

create index if not exists space_booking_group_idx on space_booking (group_id);

-- ─────────────────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────────────────
-- Cancellare metà di una notte lascerebbe l'altra metà orfana: chi tocca la
-- fascia delle 00:30 di venerdì si aspetta di annullare la serata di giovedì,
-- non di accorciarla.

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
-- group_id esce anche verso il client: serve a mostrare le due metà come una
-- prenotazione sola invece che come due tronconi senza rapporto fra loro.

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
