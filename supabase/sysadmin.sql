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
-- Ruolo sistemista: prenotazioni ricorrenti e pulizia.
--
-- L'autorizzazione si applica in /api/admin/data: queste funzioni non sono
-- raggiungibili dal pannello di portineria, solo dal sistemista.

-- ─────────────────────────────────────────────────────────────────────────────
-- Regole ricorrenti
--
-- Una regola dice "ogni lunedì alle 09:30 la lavatrice A è della camera 101".
-- Non è una prenotazione: è la ricetta con cui, ogni lunedì notte, le
-- prenotazioni della settimana vengono create.
--
-- Materializzate e non calcolate al volo, di proposito: così compaiono nella
-- griglia come tutte le altre, i promemoria partono senza casi speciali, e in
-- una settimana particolare si può cancellare la singola occorrenza senza
-- toccare la regola.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists recurring_booking (
  id          bigserial primary key,
  kind        text     not null check (kind in ('laundry', 'space')),
  day         smallint not null check (day between 0 and 6),
  note        text,
  active      boolean  not null default true,
  created_at  timestamptz not null default now(),
  created_by  text not null default 'sistemista',

  -- Lavanderia
  laundry_id   smallint references laundry(id) on delete cascade,
  slot         smallint check (slot between 0 and 18),
  machine_code text,
  room         text check (room is null or room = 'DIREZIONE' or room ~ '^[0-9]{1,4}(-?[abAB])?$'),

  -- Sale
  space_id   smallint references room_space(id) on delete cascade,
  start_min  int check (start_min between 0 and 1439),
  end_min    int check (end_min > start_min and end_min <= 2880),
  name       text check (length(name) between 1 and 40),
  btype      text check (btype in ('private', 'open')),

  -- Ogni tipo riempie le sue colonne e lascia vuote le altre: un vincolo, non
  -- una convenzione da ricordare.
  constraint recurring_shape check (
    (kind = 'laundry' and laundry_id is not null and slot is not null
       and machine_code is not null and room is not null
       and space_id is null)
    or
    (kind = 'space' and space_id is not null and start_min is not null
       and end_min is not null and name is not null
       and laundry_id is null)
  ),

  foreign key (laundry_id, machine_code) references machine(laundry_id, code)
);

-- Una sola regola attiva per slot: due regole sullo stesso turno sarebbero
-- una contraddizione, e se ne applicherebbe una a caso.
create unique index if not exists recurring_laundry_uniq
  on recurring_booking (laundry_id, day, slot, machine_code)
  where kind = 'laundry' and active;

create index if not exists recurring_active_idx on recurring_booking (kind, active);

alter table recurring_booking enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Applicazione
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Scrive le prenotazioni della settimana a partire dalle regole attive.
 *
 * Idempotente: si può richiamare quante volte si vuole sulla stessa settimana.
 * ON CONFLICT DO NOTHING significa che una prenotazione già presente vince
 * sulla regola — è voluto: se qualcuno ha ottenuto quel turno, non glielo
 * togliamo alle spalle. Il conteggio degli scartati dice quando succede.
 */
create or replace function apply_recurring(p_offset int default 0)
returns jsonb language plpgsql as $$
declare
  v_lav  int := 0;
  v_sale int := 0;
  v_skip int := 0;
  v_ws   date;
  r      record;
  v_id   bigint;
begin
  -- Lavanderia
  for r in
    select rb.*, l.tz from recurring_booking rb
    join laundry l on l.id = rb.laundry_id
    where rb.kind = 'laundry' and rb.active
  loop
    v_ws := current_week_start(r.tz) + (p_offset * 7);

    insert into laundry_booking (laundry_id, week_start, day, slot, machine_code, room, created_by)
    values (r.laundry_id, v_ws, r.day, r.slot, r.machine_code, r.room, 'admin')
    on conflict (laundry_id, week_start, day, slot, machine_code) do nothing
    returning id into v_id;

    if v_id is null then v_skip := v_skip + 1; else v_lav := v_lav + 1; end if;
    v_id := null;
  end loop;

  -- Sale
  v_ws := current_week_start('Europe/Rome') + (p_offset * 7);
  for r in
    select * from recurring_booking where kind = 'space' and active
  loop
    begin
      insert into space_booking (space_id, week_start, day, start_min, end_min, name, btype, created_by)
      values (r.space_id, v_ws, r.day, r.start_min, r.end_min, r.name, r.btype, 'admin');
      v_sale := v_sale + 1;
    exception
      -- Sovrapposizione con qualcosa che c'è già: la regola cede.
      when exclusion_violation then v_skip := v_skip + 1;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true, 'lavanderia', v_lav, 'sale', v_sale, 'saltate', v_skip
  );
end;
$$;

create or replace function recurring_list()
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'items', coalesce(jsonb_agg(x order by x->>'kind', (x->>'day')::int), '[]'::jsonb))
  from (
    select jsonb_strip_nulls(jsonb_build_object(
      'id', rb.id, 'kind', rb.kind, 'day', rb.day, 'active', rb.active, 'note', rb.note,
      'laundry', l.name, 'laundry_id', rb.laundry_id,
      'slot', rb.slot, 'machine', rb.machine_code, 'room', rb.room,
      'space', s.slug, 'space_id', rb.space_id,
      'start', rb.start_min, 'end', rb.end_min, 'name', rb.name, 'type', rb.btype
    )) as x
    from recurring_booking rb
    left join laundry l on l.id = rb.laundry_id
    left join room_space s on s.id = rb.space_id
  ) t;
$$;

-- Versione consolidata dalla migrazione 009. Vedi supabase/migrations/
-- per il perche' del cambiamento: qui c'e' solo il risultato.
create or replace function recurring_add_laundry(
  p_laundry_id smallint, p_day int, p_slot int, p_machine text, p_room text, p_note text default null
) returns jsonb language plpgsql as $$
declare v_id bigint;
begin
  if not exists (select 1 from machine where laundry_id = p_laundry_id and code = p_machine and bookable) then
    return jsonb_build_object('ok', false, 'error', 'macchina non valida per questa lavanderia');
  end if;

  -- DIREZIONE non ha un numero e non appartiene a un intervallo: è l'unica
  -- eccezione, come nel resto dello schema.
  if p_room <> 'DIREZIONE' and not exists (
    select 1 from laundry
    where id = p_laundry_id
      and nullif(substring(p_room from '^[0-9]+'), '')::int between room_min and room_max
  ) then
    return jsonb_build_object('ok', false, 'error', 'quella camera non appartiene a questa lavanderia');
  end if;

  insert into recurring_booking (kind, laundry_id, day, slot, machine_code, room, note)
  values ('laundry', p_laundry_id, p_day, p_slot, p_machine, p_room, p_note)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'esiste già una regola per questo turno');
end;
$$;

create or replace function recurring_add_space(
  p_space_id smallint, p_day int, p_start int, p_end int, p_name text,
  p_type text default null, p_note text default null
) returns jsonb language plpgsql as $$
declare
  v_id  bigint;
  v_end int := p_end;
begin
  -- Stessa semantica delle prenotazioni normali: un turno che scavalca la
  -- mezzanotte ha end <= start e si porta a end + 1440.
  if v_end <= p_start then v_end := v_end + 1440; end if;

  insert into recurring_booking (kind, space_id, day, start_min, end_min, name, btype, note)
  values ('space', p_space_id, p_day, p_start, v_end, left(btrim(p_name), 40),
          case when (select has_type from room_space where id = p_space_id) then p_type else null end,
          p_note)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function recurring_set_active(p_id bigint, p_active boolean)
returns jsonb language plpgsql as $$
begin
  update recurring_booking set active = p_active where id = p_id;
  return jsonb_build_object('ok', found);
end;
$$;

create or replace function recurring_delete(p_id bigint)
returns jsonb language plpgsql as $$
declare v_n int;
begin
  delete from recurring_booking where id = p_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Pulizia
--
-- Distruttiva per definizione: il chiamante deve dire cosa vuole cancellare,
-- non esiste un "pulisci" generico senza argomenti.
-- ─────────────────────────────────────────────────────────────────────────────

-- NOTA sui `where id is not null` che sembrano inutili.
--
-- Supabase attiva l'estensione safeupdate sulla connessione usata da PostgREST:
-- ogni DELETE o UPDATE senza WHERE viene rifiutato con
-- "21000: DELETE requires a WHERE clause". Vale anche per le istruzioni dentro
-- una funzione chiamata via RPC.
--
-- Il risultato era insidioso: `select sysadmin_purge('tutto')` dal SQL Editor
-- funzionava (connessione diversa, nessuna protezione), mentre lo stesso
-- pulsante nel pannello falliva sempre — e l'API restituiva un generico
-- "errore del server", quindi sembrava che il pulsante non facesse nulla.
--
-- Le condizioni qui sotto sono sempre vere e servono solo a soddisfare quel
-- controllo. Non toglierle.
create or replace function sysadmin_purge(p_scope text)
returns jsonb language plpgsql as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_n int;
begin
  if p_scope not in ('prenotazioni', 'settimana', 'segnalazioni', 'notifiche', 'ricorrenti', 'tutto') then
    return jsonb_build_object('ok', false, 'error', 'ambito non riconosciuto');
  end if;

  -- Solo la settimana corrente: il caso normale, per ripartire da zero senza
  -- perdere lo storico.
  if p_scope in ('settimana', 'tutto') then
    delete from laundry_booking where week_start = current_week_start('Europe/Rome');
    get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('prenotazioni_settimana', v_n);

    delete from space_booking where week_start = current_week_start('Europe/Rome');
    get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('sale_settimana', v_n);
  end if;

  -- Tutto lo storico delle prenotazioni.
  if p_scope in ('prenotazioni', 'tutto') then
    delete from laundry_booking where id is not null;  get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('prenotazioni', v_n);
    delete from space_booking where id is not null;    get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('sale', v_n);
  end if;

  if p_scope in ('segnalazioni', 'tutto') then
    delete from feedback where id is not null;  get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('segnalazioni', v_n);
  end if;

  if p_scope in ('notifiche', 'tutto') then
    delete from push_sub where id is not null;      get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('push', v_n);
    delete from telegram_sub where id is not null;  get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('telegram', v_n);
  end if;

  if p_scope in ('ricorrenti', 'tutto') then
    delete from recurring_booking where id is not null;  get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('ricorrenti', v_n);
  end if;

  if p_scope = 'tutto' then
    delete from rate_limit where bucket is not null;
    -- audit_log NON si cancella: serve proprio a sapere chi ha svuotato cosa.
    update machine set is_oos = not bookable where laundry_id is not null;
    v_out := v_out || jsonb_build_object('macchine_ripristinate', true);
  end if;

  return jsonb_build_object('ok', true, 'cancellati', v_out);
end;
$$;
