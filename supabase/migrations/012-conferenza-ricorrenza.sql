-- Ricorrenza settimanale della sala polivalente, e controllo esatto delle
-- sovrapposizioni.
--
-- Il modello dati la ricorrenza la sapeva già fare — una riga con
-- `giorno_settimana` valorizzato e un intervallo `dal`/`al` è "ogni martedì
-- dal … al …", e `conference_agenda` la espande in lettura. Mancava solo che
-- il pannello sapesse crearla. Qui non cambia nulla della tabella: cambia il
-- controllo che decide se una nuova regola può stare insieme alle altre.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Perché il vecchio controllo non basta più
--
-- Finora era:
--
--   daterange(e.dal, e.al) && daterange(p_dal, p_al)
--   and (e.giorno_settimana is null or v_giorno is null
--        or e.giorno_settimana = v_giorno)
--
-- cioè: intervalli di date che si toccano + stesso giorno della settimana.
-- Con eventi di un giorno solo era accettabile, perché il caso "due regole
-- settimanali diverse" non esisteva. Adesso esiste, e quella condizione dà
-- due risposte sbagliate:
--
--  1. FALSO CONFLITTO. Un evento singolo di lunedì ha `giorno_settimana` NULL
--     (migrazione 010 lo azzera di proposito: per un giorno solo la cadenza
--     non vuol dire niente). Il ramo `e.giorno_settimana is null` lo rende
--     quindi in conflitto con QUALSIASI regola settimanale il cui periodo lo
--     contenga — anche una che cade di martedì e non lo tocca mai. In pratica:
--     un singolo evento programmato a novembre avrebbe impedito di creare il
--     corso del martedì di tutto l'anno.
--
--  2. FALSO VIA LIBERA (raro ma peggiore). Due regole sullo stesso giorno
--     della settimana i cui periodi si sovrappongono di pochi giorni che quel
--     giorno non lo contengono venivano dichiarate in conflitto — qui l'errore
--     è di nuovo verso il blocco, quindi innocuo. Ma la simmetria opposta
--     (periodi che si toccano senza condividere occorrenze) restava invisibile
--     al controllo.
--
-- La versione qui sotto smette di approssimare: espande l'intersezione dei due
-- periodi giorno per giorno e chiede se esiste ALMENO UNA data che soddisfa il
-- filtro di entrambe le regole. È la definizione stessa di "si sovrappongono",
-- non una sua euristica. Costa una generate_series su un intervallo già
-- limitato a 400 giorni, e solo per le regole il cui periodo si tocca.

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

-- Stessa firma di prima: nessuna nuova overload, quindi PostgREST continua a
-- risolvere la chiamata senza ambiguità (la lezione di book_laundry nella 005).
revoke all on function conference_add(text, text, text, date, date, int, text, text) from public, anon, authenticated;
grant execute on function conference_add(text, text, text, date, date, int, text, text) to service_role;
