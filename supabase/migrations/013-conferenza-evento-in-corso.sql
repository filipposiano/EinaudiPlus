-- "Occupata adesso" adesso dice anche DA COSA.
--
-- La schermata rispondeva alla domanda giusta ("posso entrarci?") ma si
-- fermava un passo prima: sapere che la sala è occupata senza sapere da cosa
-- lascia comunque a chiedere in giro, che è esattamente la telefonata che
-- questa pagina dovrebbe evitare. Il dato c'era già — la riga che stabilisce
-- `occupata_adesso` è la stessa che conosce il titolo — e veniva buttata via.
--
-- Il titolo si prende QUI e non lato client, pur avendo il client già l'elenco
-- delle occorrenze in memoria: `occupata_adesso` lo decide il database con
-- l'ora di Roma, e un telefono con l'orologio sfasato o in un altro fuso
-- avrebbe potuto mostrare "occupata" senza trovare nessun evento a cui
-- attribuirla — due affermazioni in contraddizione nella stessa schermata.
-- Venendo dalla stessa query, non possono discordare.

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

-- Stessa firma: nessuna nuova overload, PostgREST continua a risolvere senza
-- ambiguita' (la lezione di book_laundry nella 005).
revoke all on function conference_agenda(int) from public, anon, authenticated;
grant execute on function conference_agenda(int) to service_role;
