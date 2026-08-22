-- Eccezioni a una programmazione ricorrente: annullare o spostare un singolo
-- incontro senza toccare la serie.
--
-- Il buco che chiude: "ogni sabato fino a maggio" era un blocco unico. Se un
-- sabato cadeva una festività, l'unico modo per liberarlo era cancellare
-- l'intera serie e ricrearla spezzata in due. Lo stesso per anticipare un solo
-- incontro al venerdì.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Perché una tabella di eccezioni e non righe materializzate
--
-- L'alternativa era creare N righe vere alla creazione della regola, una per
-- occorrenza: modificarne una diventerebbe banale, è solo una riga.
--
-- Non si fa, e il motivo sta già in questo stesso schema. Le regole ricorrenti
-- della LAVANDERIA sono materializzate (apply_recurring le scrive ogni notte),
-- e lì è giusto: quegli slot sono contesi, e serve una riga vera su cui il
-- vincolo `unique` possa impedire la doppia prenotazione. La sala polivalente
-- non ha niente da contendere — nessuno prenota contro di lei, la si legge —
-- quindi materializzare pagherebbe il prezzo (cinquanta righe per un corso
-- annuale, il rischio che regola e occorrenze divergano, l'orario da correggere
-- cinquanta volte invece di una) senza incassare il beneficio che in
-- lavanderia lo giustifica.
--
-- Qui la regola resta una riga sola e si registra solo ciò che DEVIA. Le
-- eccezioni sono rare per natura: una festività, un rinvio. Memorizzare le
-- deviazioni invece dei casi normali è la forma che corrisponde ai fatti.
--
-- È anche il modello di iCalendar (RFC 5545), dove `data_originale` si chiama
-- RECURRENCE-ID e fa esattamente questo mestiere: dire QUALE occorrenza della
-- serie si sta toccando.

create table if not exists conference_eccezione (
  id             bigserial primary key,
  event_id       bigint not null references conference_event(id) on delete cascade,

  -- La data in cui la REGOLA avrebbe prodotto l'occorrenza. È la chiave
  -- logica dell'eccezione: identifica l'incontro anche dopo che è stato
  -- spostato altrove.
  data_originale date not null,

  tipo           text not null check (tipo in ('annullata', 'spostata')),

  -- Solo per 'spostata'. NULL = eredita dalla regola, così si può spostare
  -- solo la data lasciando gli orari, o viceversa.
  nuova_data     date,
  ora_inizio     time,
  ora_fine       time,
  titolo         text check (titolo is null or length(btrim(titolo)) between 1 and 60),
  note           text check (note is null or length(note) <= 300),

  creato_da      text,
  created_at     timestamptz not null default now(),

  -- Un'eccezione sola per occorrenza: due si contraddirebbero, e non ci
  -- sarebbe modo di decidere quale vince.
  unique (event_id, data_originale),
  check (tipo = 'annullata' or nuova_data is not null),
  check (ora_inizio is null or ora_fine is null or ora_fine > ora_inizio)
);

create index if not exists conference_eccezione_evento_idx
  on conference_eccezione (event_id, data_originale);

alter table conference_eccezione enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Espansione, ora con le eccezioni applicate.
--
-- Una `left join` sulla data generata: se non c'è eccezione la riga esce
-- com'è, se è 'annullata' sparisce, se è 'spostata' i suoi campi valorizzati
-- prendono il posto di quelli della regola.

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
             'titolo', coalesce(x.titolo, e.titolo),
             'note',   coalesce(x.note, e.note),
             -- g.d e' un timestamp: senza il cast usciva "2026-10-07T00:00:00"
             -- e il client, che ci concatena l'ora, non sapeva piu' leggerlo.
             'data',   coalesce(x.nuova_data, g.d::date),
             'inizio', to_char(coalesce(x.ora_inizio, e.ora_inizio), 'HH24:MI'),
             'fine',   to_char(coalesce(x.ora_fine,   e.ora_fine),   'HH24:MI'),
             'ricorrente', e.giorno_settimana is not null and e.al > e.dal,
             -- I campi della REGOLA, per precompilare il modulo di modifica
             -- senza un secondo giro di rete.
             'dal', e.dal, 'al', e.al, 'giorno', e.giorno_settimana,
             -- La data con cui questa occorrenza va nominata quando la si
             -- vuole annullare o spostare: e' la data che la REGOLA produce,
             -- non quella a cui si vede. Senza, spostare due volte lo stesso
             -- incontro creerebbe una seconda eccezione invece di correggere
             -- la prima.
             'data_regola', g.d::date,
             'spostata', x.id is not null
           ) as x
    from conference_event e
    cross join lateral generate_series(
      greatest(e.dal, v_da)::timestamp,
      least(e.al, v_a)::timestamp,
      interval '1 day'
    ) g(d)
    left join conference_eccezione x
      on x.event_id = e.id and x.data_originale = g.d::date
    where (e.giorno_settimana is null
           or extract(isodow from g.d)::int - 1 = e.giorno_settimana)
      and (x.id is null or x.tipo <> 'annullata')
  ) s;

  -- Occupata adesso, e da cosa. Guarda sia le occorrenze che la regola
  -- produce oggi (saltando le annullate), sia quelle SPOSTATE a oggi da un
  -- altro giorno: un incontro anticipato a venerdì occupa la sala di venerdì,
  -- e non accorgersene qui direbbe "libera" con la gente dentro.
  select ora_fine, titolo, note into v_ora_fine, v_titolo, v_note
  from (
    -- occorrenze naturali di oggi, non annullate e non spostate altrove
    select coalesce(x.ora_inizio, e.ora_inizio) as ora_inizio,
           coalesce(x.ora_fine,   e.ora_fine)   as ora_fine,
           coalesce(x.titolo, e.titolo)         as titolo,
           coalesce(x.note,   e.note)           as note
    from conference_event e
    left join conference_eccezione x
      on x.event_id = e.id and x.data_originale = v_da
    where v_da between e.dal and e.al
      and (e.giorno_settimana is null
           or extract(isodow from v_da)::int - 1 = e.giorno_settimana)
      and (x.id is null or (x.tipo = 'spostata' and coalesce(x.nuova_data, v_da) = v_da))

    union all

    -- incontri spostati DA un altro giorno A oggi
    select coalesce(x.ora_inizio, e.ora_inizio),
           coalesce(x.ora_fine,   e.ora_fine),
           coalesce(x.titolo, e.titolo),
           coalesce(x.note,   e.note)
    from conference_eccezione x
    join conference_event e on e.id = x.event_id
    where x.tipo = 'spostata' and x.nuova_data = v_da and x.data_originale <> v_da
  ) oggi
  where v_ora >= ora_inizio and v_ora < ora_fine
  order by ora_fine desc
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Annullare UN incontro.

create or replace function conference_skip(
  p_id bigint, p_data date, p_attore text default null
) returns jsonb language plpgsql as $$
begin
  if not exists (select 1 from conference_event where id = p_id) then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;

  insert into conference_eccezione (event_id, data_originale, tipo, creato_da)
  values (p_id, p_data, 'annullata', p_attore)
  -- Se quell'incontro era gia' stato spostato, annullarlo vince: chi preme
  -- "annulla questo incontro" vuole che sparisca, non che resti dove l'aveva
  -- messo prima.
  on conflict (event_id, data_originale) do update
    set tipo = 'annullata', nuova_data = null, ora_inizio = null,
        ora_fine = null, titolo = null, note = null;

  return conference_agenda(60);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Spostare o modificare UN incontro, slegandolo dalla serie.

create or replace function conference_move(
  p_id bigint,
  p_data date,              -- la data che la REGOLA produce (RECURRENCE-ID)
  p_nuova_data date,
  p_ora_inizio text default null,
  p_ora_fine text default null,
  p_titolo text default null,
  p_note text default null,
  p_attore text default null
) returns jsonb language plpgsql as $$
declare
  v_in  time := nullif(p_ora_inizio, '')::time;
  v_fi  time := nullif(p_ora_fine, '')::time;
  v_ev  conference_event%rowtype;
  v_conflitto text;
begin
  select * into v_ev from conference_event where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;

  -- Orari effettivi dell'incontro spostato: quelli dati, o quelli della regola.
  v_in := coalesce(v_in, v_ev.ora_inizio);
  v_fi := coalesce(v_fi, v_ev.ora_fine);
  if v_fi <= v_in then
    return jsonb_build_object('ok', false, 'error', 'orario non valido');
  end if;

  -- Sovrapposizioni nella data di ARRIVO. Si guardano le occorrenze che
  -- cadono quel giorno per qualunque ALTRA regola, saltando quelle annullate
  -- e quelle a loro volta spostate via.
  select coalesce(x2.titolo, e2.titolo) into v_conflitto
  from conference_event e2
  left join conference_eccezione x2
    on x2.event_id = e2.id and x2.data_originale = p_nuova_data
  where e2.id <> p_id
    and p_nuova_data between e2.dal and e2.al
    and (e2.giorno_settimana is null
         or extract(isodow from p_nuova_data)::int - 1 = e2.giorno_settimana)
    and (x2.id is null or (x2.tipo = 'spostata' and coalesce(x2.nuova_data, p_nuova_data) = p_nuova_data))
    and v_in < coalesce(x2.ora_fine, e2.ora_fine)
    and coalesce(x2.ora_inizio, e2.ora_inizio) < v_fi
  limit 1;

  if v_conflitto is not null then
    return jsonb_build_object('ok', false, 'error', 'sovrapposto',
                              'con', v_conflitto, 'quando', p_nuova_data);
  end if;

  insert into conference_eccezione (event_id, data_originale, tipo, nuova_data,
                                    ora_inizio, ora_fine, titolo, note, creato_da)
  values (p_id, p_data, 'spostata', p_nuova_data, v_in, v_fi,
          nullif(btrim(coalesce(p_titolo, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), p_attore)
  -- Spostare due volte lo stesso incontro corregge l'eccezione, non ne
  -- aggiunge una seconda: `data_originale` resta il suo nome per sempre.
  on conflict (event_id, data_originale) do update
    set tipo = 'spostata', nuova_data = excluded.nuova_data,
        ora_inizio = excluded.ora_inizio, ora_fine = excluded.ora_fine,
        titolo = excluded.titolo, note = excluded.note;

  return conference_agenda(60);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rimettere un incontro come lo vuole la regola.

create or replace function conference_reset_occorrenza(p_id bigint, p_data date)
returns jsonb language plpgsql as $$
begin
  delete from conference_eccezione where event_id = p_id and data_originale = p_data;
  return conference_agenda(60);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Accorciare il periodo di una regola lascia eccezioni su date che la regola
-- non produce piu'. In lettura sono innocue (la join non le incontra), ma
-- restano a sporcare, e se un giorno il periodo si riallunga tornerebbero
-- vive a sorpresa. conference_update le pota.

create or replace function conference_update(
  p_id bigint,
  p_titolo text,
  p_ora_inizio text,
  p_ora_fine text,
  p_dal date,
  p_al date,
  p_giorno_settimana int default null,
  p_note text default null
) returns jsonb language plpgsql as $$
declare
  v_in     time := p_ora_inizio::time;
  v_fi     time := p_ora_fine::time;
  v_giorno int  := case when p_dal = p_al then null else p_giorno_settimana end;
  v_conflitto text;
  v_quando    date;
begin
  if not exists (select 1 from conference_event where id = p_id) then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;
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

  -- Controllo esatto come nella 012/014, saltando se stessa e le occorrenze
  -- annullate dell'altra regola: una data che l'altro evento non occupa piu'
  -- non deve bloccare niente.
  select e.titolo, g.d::date into v_conflitto, v_quando
  from conference_event e
  cross join lateral generate_series(
    greatest(e.dal, p_dal)::timestamp,
    least(e.al, p_al)::timestamp,
    interval '1 day'
  ) g(d)
  left join conference_eccezione x
    on x.event_id = e.id and x.data_originale = g.d::date
  where e.id <> p_id
    and v_in < coalesce(x.ora_fine, e.ora_fine)
    and coalesce(x.ora_inizio, e.ora_inizio) < v_fi
    and (e.giorno_settimana is null or extract(isodow from g.d)::int - 1 = e.giorno_settimana)
    and (v_giorno is null              or extract(isodow from g.d)::int - 1 = v_giorno)
    and (x.id is null or x.tipo <> 'annullata')
  order by g.d
  limit 1;

  if v_conflitto is not null then
    return jsonb_build_object('ok', false, 'error', 'sovrapposto',
                              'con', v_conflitto, 'quando', v_quando);
  end if;

  update conference_event
  set titolo = left(btrim(p_titolo), 60),
      ora_inizio = v_in, ora_fine = v_fi,
      dal = p_dal, al = p_al, giorno_settimana = v_giorno,
      note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_id;

  -- Potatura delle eccezioni rimaste fuori dal nuovo periodo o dalla nuova
  -- cadenza: senza, riallungando il periodo tornerebbero vive a sorpresa.
  delete from conference_eccezione
  where event_id = p_id
    and (data_originale < p_dal
         or data_originale > p_al
         or (v_giorno is not null
             and extract(isodow from data_originale)::int - 1 <> v_giorno));

  return conference_agenda(60);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permessi: come tutto il resto, solo il ruolo che usa /api.

revoke all on function conference_agenda(int) from public, anon, authenticated;
revoke all on function conference_update(bigint, text, text, text, date, date, int, text) from public, anon, authenticated;
revoke all on function conference_skip(bigint, date, text) from public, anon, authenticated;
revoke all on function conference_move(bigint, date, date, text, text, text, text, text) from public, anon, authenticated;
revoke all on function conference_reset_occorrenza(bigint, date) from public, anon, authenticated;

grant execute on function conference_agenda(int) to service_role;
grant execute on function conference_update(bigint, text, text, text, date, date, int, text) to service_role;
grant execute on function conference_skip(bigint, date, text) to service_role;
grant execute on function conference_move(bigint, date, date, text, text, text, text, text) to service_role;
grant execute on function conference_reset_occorrenza(bigint, date) to service_role;
