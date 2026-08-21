-- Sala conferenze.
--
-- Non e' una sala come cinema e musica, e non usa la loro tabella. Tre
-- differenze che cambiano il modello, non solo l'interfaccia:
--
--   1. La prenotano SOLO gli amministratori. I residenti la guardano: vogliono
--      sapere se adesso e' libera e quando sara' occupata, non prenotarla.
--   2. La programmazione arriva a un anno, non a una settimana. `space_booking`
--      e' costruita su (week_start, day 0-6) e viene potata a fine settimana:
--      infilarci un corso che dura fino a giugno voleva dire combattere contro
--      il modello a ogni riga.
--   3. Si programma per REGOLE, non per singole occorrenze: "ogni martedi'
--      dalle 14 alle 18, dal 7 ottobre al 30 maggio".
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Regole, non occorrenze
--
-- Un corso settimanale per un anno accademico sono una quarantina di date. Si
-- potrebbero materializzare, come si fa per le prenotazioni ricorrenti della
-- lavanderia — li' pero' serve, perche' quelle finiscono in una griglia
-- prenotabile e devono occupare uno slot vero.
--
-- Qui no: nessuno prenota contro la sala conferenze, la si legge e basta.
-- Quindi la regola si espande al momento della lettura. Costa una `generate_series`
-- su poche righe, e in cambio: niente job notturno, niente disallineamento fra
-- regola e occorrenze, e correggere l'orario di un corso lo corregge su tutte
-- le date future in un colpo solo invece che su quaranta righe.

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

-- ─────────────────────────────────────────────────────────────────────────────
-- Lettura pubblica: l'agenda espansa.
--
-- Restituisce le occorrenze vere (data + orario) di tutte le regole che
-- ricadono nella finestra chiesta, ordinate. `adesso` dice se la sala e'
-- occupata in questo momento e fino a quando: e' la prima cosa che un residente
-- vuole sapere, e calcolarla qui evita che ogni client se la ricavi a modo suo.

create or replace function conference_agenda(p_giorni int default 30)
returns jsonb language plpgsql stable as $$
declare
  v_da   date := (now() at time zone 'Europe/Rome')::date;
  v_a    date := v_da + greatest(1, least(p_giorni, 400));
  v_ora  time := (now() at time zone 'Europe/Rome')::time;
  v_occorrenze jsonb;
  v_ora_fine time;
begin
  select coalesce(jsonb_agg(x order by x->>'data', x->>'inizio'), '[]'::jsonb)
  into v_occorrenze
  from (
    select jsonb_build_object(
             'id',     e.id,
             'titolo', e.titolo,
             'note',   e.note,
             -- g.d e' un timestamp (generate_series lavora su timestamp, non
             -- su date): senza il cast finiva in jsonb come "2026-10-07T00:00:00",
             -- e il frontend (che si aspetta "2026-10-07" e ci concatena lui
             -- stesso l'ora per fare new Date()) costruiva una stringa doppia
             -- e non riusciva piu' a leggere la data.
             'data',   g.d::date,
             'inizio', to_char(e.ora_inizio, 'HH24:MI'),
             'fine',   to_char(e.ora_fine,   'HH24:MI'),
             -- Serve al pannello per dire "ogni martedi'" invece di ripetere
             -- quaranta volte la stessa riga.
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

  -- Occupata adesso? Si guarda solo oggi, ovviamente.
  select e.ora_fine into v_ora_fine
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
    'occorrenze', v_occorrenze
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Scrittura: solo dal pannello amministrativo (/api/admin/data verifica il
-- cookie prima di arrivare qui).

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
  v_in time := p_ora_inizio::time;
  v_fi time := p_ora_fine::time;
  v_conflitto text;
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

  -- Sovrapposizioni: un vincolo di esclusione non basta, perche' le regole non
  -- sono intervalli ma ricette. Si espandono entrambe e si confrontano.
  --
  -- Blocca invece di avvisare: due corsi nella stessa sala alla stessa ora sono
  -- sempre un errore di chi scrive, e scoprirlo a settembre e' peggio che
  -- scoprirlo adesso.
  select e.titolo into v_conflitto
  from conference_event e
  where daterange(e.dal, e.al, '[]') && daterange(p_dal, p_al, '[]')
    and (e.giorno_settimana is null or p_giorno_settimana is null
         or e.giorno_settimana = p_giorno_settimana)
    and v_in < e.ora_fine and e.ora_inizio < v_fi
  limit 1;

  if v_conflitto is not null then
    return jsonb_build_object('ok', false, 'error', 'sovrapposto', 'con', v_conflitto);
  end if;

  insert into conference_event (titolo, ora_inizio, ora_fine, dal, al, giorno_settimana, note, creato_da)
  values (left(btrim(p_titolo), 60), v_in, v_fi, p_dal, p_al, p_giorno_settimana,
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

-- L'elenco delle REGOLE (non delle occorrenze), per il pannello: e' li' che si
-- cancella "ogni martedi' fino a maggio" in un colpo solo.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Permessi: come tutto il resto, eseguibili solo dal ruolo che usa /api.
-- Senza queste righe le funzioni nascono con EXECUTE concesso a PUBLIC — vedi
-- la migrazione 005.

revoke all on function conference_agenda(int) from public, anon, authenticated;
revoke all on function conference_add(text, text, text, date, date, int, text, text) from public, anon, authenticated;
revoke all on function conference_delete(bigint) from public, anon, authenticated;
revoke all on function conference_rules() from public, anon, authenticated;

grant execute on function conference_agenda(int) to service_role;
grant execute on function conference_add(text, text, text, date, date, int, text, text) to service_role;
grant execute on function conference_delete(bigint) to service_role;
grant execute on function conference_rules() to service_role;

alter table conference_event enable row level security;
