-- Sala polivalente.
--
-- File consolidato dalle migrazioni 007 (impianto), 010 e 012 (ricorrenza e
-- controllo esatto delle sovrapposizioni). Le migrazioni restano la storia del
-- perche'; qui c'e' lo stato finale, quello che serve per ricostruire.
--
-- La sala non si prenota: la programma la direzione e i residenti la leggono.
-- Una riga e' una REGOLA ("ogni martedi' dal 7 ottobre al 30 maggio"), espansa
-- in occorrenze al momento della lettura da conference_agenda.

create table if not exists conference_event (
  id          bigserial primary key,
  titolo      text not null check (length(btrim(titolo)) between 1 and 60),
  -- L'orario, uguale per ogni occorrenza della regola.
  ora_inizio  time not null,
  ora_fine    time not null,
  -- Il periodo in cui la regola vale. Per un evento singolo: dal = al.
  dal         date not null,
  al          date not null,
  -- 0 = lunedi' … 6 = domenica. NULL = tutti i giorni del periodo, che serve
  -- per gli eventi di piu' giorni consecutivi (un convegno di tre giorni).
  giorno_settimana smallint check (giorno_settimana between 0 and 6),
  note        text check (note is null or length(note) <= 300),
  creato_da   text,
  created_at  timestamptz not null default now(),
  check (ora_fine > ora_inizio),
  check (al >= dal)
);

create index if not exists conference_event_periodo_idx on conference_event (dal, al);

create or replace function conference_agenda(p_giorni int default 30)
returns jsonb language plpgsql stable as $$
declare
  v_da   date := (now() at time zone 'Europe/Rome')::date;
  v_a    date := v_da + greatest(1, least(p_giorni, 400));
  v_ora  time := (now() at time zone 'Europe/Rome')::time;
  v_occorrenze jsonb;
  v_ora_fine time;
  v_titolo   text;
  v_note     text;
begin
  select coalesce(jsonb_agg(x order by x->>'data', x->>'inizio'), '[]'::jsonb)
  into v_occorrenze
  from (
    select jsonb_build_object(
             'id',     e.id,
             'titolo', e.titolo,
             'note',   e.note,
             -- g.d e' un timestamp: senza il cast usciva "2026-10-07T00:00:00"
             -- e il client, che ci concatena l'ora, non sapeva piu' leggerlo.
             'data',   g.d::date,
             'inizio', to_char(e.ora_inizio, 'HH24:MI'),
             'fine',   to_char(e.ora_fine,   'HH24:MI'),
             'ricorrente', e.giorno_settimana is not null and e.al > e.dal
           ) as x
    from conference_event e
    cross join lateral generate_series(
      greatest(e.dal, v_da)::timestamp,
      least(e.al, v_a)::timestamp,
      interval '1 day'
    ) g(d)
    where e.giorno_settimana is null
       or extract(isodow from g.d)::int - 1 = e.giorno_settimana
  ) s;

  -- Occupata adesso, e da cosa. Stessa riga per entrambe le risposte: e' il
  -- motivo per cui non possono contraddirsi.
  select e.ora_fine, e.titolo, e.note
    into v_ora_fine, v_titolo, v_note
  from conference_event e
  where v_da between e.dal and e.al
    and (e.giorno_settimana is null
         or extract(isodow from v_da)::int - 1 = e.giorno_settimana)
    and v_ora >= e.ora_inizio and v_ora < e.ora_fine
  order by e.ora_fine desc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'occupata_adesso', v_ora_fine is not null,
    'libera_dalle', to_char(v_ora_fine, 'HH24:MI'),
    'evento_adesso', v_titolo,
    'note_adesso', v_note,
    'occorrenze', v_occorrenze
  );
end;
$$;

create or replace function conference_add(
  p_titolo text,
  p_ora_inizio text,
  p_ora_fine text,
  p_dal date,
  p_al date,
  p_giorno_settimana int default null,
  p_note text default null,
  p_attore text default null
) returns jsonb language plpgsql as $$
declare
  v_in     time := p_ora_inizio::time;
  v_fi     time := p_ora_fine::time;
  -- Un evento di un giorno solo non ha una cadenza settimanale: vedi 010.
  v_giorno int  := case when p_dal = p_al then null else p_giorno_settimana end;
  v_conflitto text;
  v_quando    date;
begin
  if p_titolo is null or btrim(p_titolo) = '' then
    return jsonb_build_object('ok', false, 'error', 'titolo mancante');
  end if;
  if v_fi <= v_in then
    return jsonb_build_object('ok', false, 'error', 'orario non valido');
  end if;
  if p_al < p_dal then
    return jsonb_build_object('ok', false, 'error', 'periodo non valido');
  end if;
  if p_al - p_dal > 400 then
    return jsonb_build_object('ok', false, 'error', 'periodo troppo lungo');
  end if;
  if v_giorno is not null and v_giorno not between 0 and 6 then
    return jsonb_build_object('ok', false, 'error', 'giorno non valido');
  end if;

  -- Il primo giorno in cui le due regole si incontrano davvero. Se non esiste,
  -- non c'è conflitto, per quanto i periodi si sovrappongano.
  select e.titolo, g.d::date into v_conflitto, v_quando
  from conference_event e
  cross join lateral generate_series(
    greatest(e.dal, p_dal)::timestamp,
    least(e.al, p_al)::timestamp,
    interval '1 day'
  ) g(d)
  where v_in < e.ora_fine and e.ora_inizio < v_fi
    and (e.giorno_settimana is null or extract(isodow from g.d)::int - 1 = e.giorno_settimana)
    and (v_giorno is null              or extract(isodow from g.d)::int - 1 = v_giorno)
  order by g.d
  limit 1;

  if v_conflitto is not null then
    -- `quando` in più rispetto a prima: con una regola annuale sapere CHE si
    -- sovrappone senza sapere DOVE lascia l'amministratore a cercare a mano
    -- fra cinquanta occorrenze.
    return jsonb_build_object('ok', false, 'error', 'sovrapposto',
                              'con', v_conflitto, 'quando', v_quando);
  end if;

  insert into conference_event (titolo, ora_inizio, ora_fine, dal, al, giorno_settimana, note, creato_da)
  values (left(btrim(p_titolo), 60), v_in, v_fi, p_dal, p_al, v_giorno,
          nullif(btrim(coalesce(p_note, '')), ''), p_attore);

  return conference_agenda(60);
end;
$$;

create or replace function conference_delete(p_id bigint)
returns jsonb language plpgsql as $$
begin
  delete from conference_event where id = p_id;
  return conference_agenda(60);
end;
$$;

create or replace function conference_rules()
returns jsonb language plpgsql stable as $$
begin
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'titolo', titolo, 'note', note,
      'inizio', to_char(ora_inizio, 'HH24:MI'),
      'fine',   to_char(ora_fine,   'HH24:MI'),
      'dal', dal, 'al', al, 'giorno', giorno_settimana
    ) order by dal, ora_inizio)
    from conference_event
    where al >= (now() at time zone 'Europe/Rome')::date
  ), '[]'::jsonb));
end;
$$;

-- Permessi: come tutto il resto, eseguibili solo dal ruolo che usa /api.
revoke all on function conference_agenda(int) from public, anon, authenticated;
revoke all on function conference_add(text, text, text, date, date, int, text, text) from public, anon, authenticated;
revoke all on function conference_delete(bigint) from public, anon, authenticated;
revoke all on function conference_rules() from public, anon, authenticated;

grant execute on function conference_agenda(int) to service_role;
grant execute on function conference_add(text, text, text, date, date, int, text, text) to service_role;
grant execute on function conference_delete(bigint) to service_role;
grant execute on function conference_rules() to service_role;

alter table conference_event enable row level security;
