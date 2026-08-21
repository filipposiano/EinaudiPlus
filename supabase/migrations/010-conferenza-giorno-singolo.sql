-- Un evento di un giorno solo (dal = al) non ha un "giorno della settimana":
-- è quel giorno, qualunque esso sia. Ma il modulo del pannello lascia sempre
-- un giorno selezionato (di default "ogni martedì"), e se non lo si cambiava
-- esplicitamente mentre si compilava un evento di un giorno solo che cadeva
-- su un altro giorno, la regola veniva creata ma non produceva MAI
-- un'occorrenza: generate_series genera un solo giorno (quello vero) e il
-- filtro sul giorno della settimana lo scartava sempre, perché'
-- giorno_settimana restava quello (sbagliato) del menu.
--
-- Risultato: la regola compare nella scheda "Programmazione" (che non
-- controlla la coerenza), ma la sala conferenze risulta sempre libera per i
-- residenti — sembra "non funzionare" e invece la regola non ha mai potuto
-- generare nulla.
--
-- Per un periodo di un solo giorno, il giorno della settimana si ignora
-- sempre: non serve a distinguere niente quando c'è un solo giorno da
-- distinguere.

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
  v_giorno int  := case when p_dal = p_al then null else p_giorno_settimana end;
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

  select e.titolo into v_conflitto
  from conference_event e
  where daterange(e.dal, e.al, '[]') && daterange(p_dal, p_al, '[]')
    and (e.giorno_settimana is null or v_giorno is null
         or e.giorno_settimana = v_giorno)
    and v_in < e.ora_fine and e.ora_inizio < v_fi
  limit 1;

  if v_conflitto is not null then
    return jsonb_build_object('ok', false, 'error', 'sovrapposto', 'con', v_conflitto);
  end if;

  insert into conference_event (titolo, ora_inizio, ora_fine, dal, al, giorno_settimana, note, creato_da)
  values (left(btrim(p_titolo), 60), v_in, v_fi, p_dal, p_al, v_giorno,
          nullif(btrim(coalesce(p_note, '')), ''), p_attore);

  return conference_agenda(60);
end;
$$;

revoke all on function conference_add(text, text, text, date, date, int, text, text) from public, anon, authenticated;
grant execute on function conference_add(text, text, text, date, date, int, text, text) to service_role;

-- Corregge anche le regole di un solo giorno già create con un giorno della
-- settimana sbagliato lasciato per sbaglio nel modulo (es. la prova
-- "Corsi PFP" di oggi, creata con "ogni martedì" mentre oggi è venerdì).
update conference_event set giorno_settimana = null where dal = al and giorno_settimana is not null;
