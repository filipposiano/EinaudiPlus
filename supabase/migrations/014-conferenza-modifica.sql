-- Modificare un evento della sala polivalente, invece di cancellarlo e
-- rifarlo.
--
-- Finora l'unico modo per spostare un corso di mezz'ora era eliminarlo e
-- ricrearlo: due passaggi, e nel mezzo la sala risultava libera a chiunque
-- guardasse. Per una regola ricorrente era peggio ancora — si perdeva
-- l'intera programmazione per cambiare un orario.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Il dettaglio che rende questa funzione diversa da conference_add
--
-- Il controllo delle sovrapposizioni deve ESCLUDERE la riga che si sta
-- modificando. Senza `e.id <> p_id`, spostare un evento dalle 14:00 alle 14:30
-- lo troverebbe in conflitto con se stesso — la vecchia versione e la nuova si
-- sovrappongono quasi sempre, ed e' esattamente cio' che deve succedere. La
-- funzione rifiuterebbe ogni modifica, in modo tanto sistematico da sembrare
-- rotta invece che prudente.

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
  -- Un evento di un giorno solo non ha cadenza settimanale: vedi 010.
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

  -- Stesso controllo esatto della 012 (si espande l'intersezione dei periodi e
  -- si cerca una data che soddisfi entrambe le regole), ma saltando se stessa.
  select e.titolo, g.d::date into v_conflitto, v_quando
  from conference_event e
  cross join lateral generate_series(
    greatest(e.dal, p_dal)::timestamp,
    least(e.al, p_al)::timestamp,
    interval '1 day'
  ) g(d)
  where e.id <> p_id
    and v_in < e.ora_fine and e.ora_inizio < v_fi
    and (e.giorno_settimana is null or extract(isodow from g.d)::int - 1 = e.giorno_settimana)
    and (v_giorno is null              or extract(isodow from g.d)::int - 1 = v_giorno)
  order by g.d
  limit 1;

  if v_conflitto is not null then
    return jsonb_build_object('ok', false, 'error', 'sovrapposto',
                              'con', v_conflitto, 'quando', v_quando);
  end if;

  update conference_event
  set titolo = left(btrim(p_titolo), 60),
      ora_inizio = v_in,
      ora_fine = v_fi,
      dal = p_dal,
      al = p_al,
      giorno_settimana = v_giorno,
      note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_id;

  return conference_agenda(60);
end;
$$;

revoke all on function conference_update(bigint, text, text, text, date, date, int, text) from public, anon, authenticated;
grant execute on function conference_update(bigint, text, text, text, date, date, int, text) to service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- L'agenda porta anche i campi della REGOLA (dal, al, giorno).
--
-- Il modulo di modifica deve nascere precompilato con cio' che l'evento e'
-- adesso, altrimenti chi vuole spostare l'orario di mezz'ora si ritrova a
-- riscrivere anche periodo e cadenza a memoria — e un campo dimenticato non
-- da' errore, cambia la programmazione in silenzio.

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
             'ricorrente', e.giorno_settimana is not null and e.al > e.dal,
             -- I campi della REGOLA, ripetuti su ogni occorrenza: servono a
             -- precompilare il modulo di modifica senza un secondo giro di
             -- rete. Costano pochi byte e tolgono una richiesta a ogni clic.
             'dal', e.dal, 'al', e.al, 'giorno', e.giorno_settimana
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

revoke all on function conference_agenda(int) from public, anon, authenticated;
grant execute on function conference_agenda(int) to service_role;
