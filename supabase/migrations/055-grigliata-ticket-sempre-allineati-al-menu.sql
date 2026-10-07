-- v1.8 — ticket della grigliata, seconda forma. Sostituisce per intero le
-- funzioni toccate da 053 e 054 (se non le hai applicate, puoi saltarle e
-- applicare solo questa).
--
-- 1. Ogni camera confermata ha SEMPRE un ticket per ogni voce del menu che
--    ha scelto, come il menu è adesso (grigliata_allinea_ticket): una voce
--    aggiunta dopo arriva subito anche a chi era già confermato. In fondo, un
--    riallineamento una tantum di tutti gli eventi esistenti.
-- 2. Il numero progressivo è UNICO per tutto l'evento (grigliata_evento.
--    ticket_contatore), qualunque sia la voce, e non si riusa mai.
-- 3. Annullare una conferma cancella TUTTI i ticket della camera, anche
--    quelli già usati.
-- 4. Il delegato può rimettere "da usare" un ticket consumato
--    (grigliata_admin_ripristina_ticket, nuova).
-- 5. Ogni voce-ticket ha un'emoji facoltativa (grigliata_menu_ticket.emoji).
--
-- Nessuna firma esistente cambia. Consolidato in supabase/grigliata.sql.

alter table grigliata_menu_ticket
  add column if not exists emoji text check (emoji is null or char_length(emoji) <= 16);

alter table grigliata_evento
  add column if not exists ticket_contatore int not null default 0;

-- Il contatore parte dal numero più alto già assegnato in ciascun evento
-- (prima di v1.8 i numeri erano per voce: si riparte dal massimo, così
-- nessun numero nuovo ne ripete uno già visto al banco).
update grigliata_evento e
  set ticket_contatore = greatest(e.ticket_contatore, coalesce((
    select max(gt.numero) from grigliata_ticket gt
    join grigliata_adesione a on a.id = gt.adesione_id
    where a.evento_id = e.id
  ), 0));

create or replace function grigliata_allinea_ticket(p_evento_id bigint)
returns void language sql as $$
  delete from grigliata_ticket gt
  using grigliata_adesione a
  where gt.adesione_id = a.id
    and a.evento_id = p_evento_id
    and not a.pagamento_confermato;

  delete from grigliata_ticket gt
  using grigliata_adesione a, grigliata_menu_ticket t
  where gt.adesione_id = a.id and gt.menu_ticket_id = t.id
    and a.evento_id = p_evento_id
    and not gt.usato
    and t.menu_id <> a.menu_id;

  insert into grigliata_ticket (adesione_id, menu_ticket_id)
  select a.id, t.id
  from grigliata_adesione a
  join grigliata_menu_ticket t on t.menu_id = a.menu_id
  where a.evento_id = p_evento_id and a.pagamento_confermato
  on conflict (adesione_id, menu_ticket_id) do nothing;
$$;

create or replace function grigliata_menu_di(p_evento_id bigint)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'nome', m.nome,
    'ticket', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome, 'emoji', t.emoji) order by t.posizione, t.id)
      from grigliata_menu_ticket t where t.menu_id = m.id
    ), '[]'::jsonb)
  ) order by m.posizione, m.id), '[]'::jsonb)
  from grigliata_menu m where m.evento_id = p_evento_id;
$$;

create or replace function grigliata_stato_pubblico(p_room text)
returns jsonb language plpgsql stable as $$
declare
  v_evento grigliata_evento%rowtype;
  v_adesione grigliata_adesione%rowtype;
begin
  select * into v_evento from grigliata_evento
    where grigliata_visibile(chiuso, giorno_evento)
    order by created_at desc limit 1;

  if v_evento.id is null then
    return jsonb_build_object('ok', true, 'attiva', false);
  end if;

  select * into v_adesione from grigliata_adesione
    where evento_id = v_evento.id and room = coalesce(p_room, '');

  return jsonb_build_object(
    'ok', true,
    'attiva', true,
    'evento', jsonb_build_object(
      'id', v_evento.id,
      'titolo', v_evento.titolo,
      'scadenza', v_evento.scadenza,
      'iscrizioni_aperte', now() < v_evento.scadenza,
      'giorno_evento', v_evento.giorno_evento,
      'pagamenti_attivi', v_evento.pagamenti_attivi,
      'quota', v_evento.quota,
      'paypal_link', v_evento.paypal_link,
      'satispay_link', v_evento.satispay_link,
      'menu', grigliata_menu_di(v_evento.id)
    ),
    'mia_adesione', case when v_adesione.id is null then null else jsonb_build_object(
      'menu_id', v_adesione.menu_id,
      'dieta', v_adesione.dieta,
      'senza_glutine', v_adesione.senza_glutine,
      'note', v_adesione.note,
      'pagamento_dichiarato', v_adesione.pagamento_dichiarato,
      'pagamento_confermato', v_adesione.pagamento_confermato,
      'ticket', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', gt.id, 'nome', mt.nome, 'emoji', mt.emoji, 'usato', gt.usato, 'numero', gt.numero
        ) order by mt.posizione, mt.id)
        from grigliata_ticket gt
        join grigliata_menu_ticket mt on mt.id = gt.menu_ticket_id
        where gt.adesione_id = v_adesione.id
      ), '[]'::jsonb)
    ) end
  );
end;
$$;

create or replace function grigliata_iscrivi(
  p_room text, p_menu_id bigint, p_dieta text, p_senza_glutine boolean, p_note text
) returns jsonb language plpgsql as $$
declare
  v_evento grigliata_evento%rowtype;
  v_evento_id bigint;
  v_dieta text;
  v_note text;
begin
  select * into v_evento from grigliata_evento
    where grigliata_visibile(chiuso, giorno_evento)
    order by created_at desc limit 1;

  if v_evento.id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;
  v_evento_id := v_evento.id;

  -- La scheda può restare visibile a iscrizioni chiuse: solo QUESTA azione
  -- (iscriversi o cambiare scelta) si ferma alla scadenza.
  if now() >= v_evento.scadenza then
    return jsonb_build_object('ok', false, 'error', 'le iscrizioni sono chiuse');
  end if;

  -- Il menu deve essere uno di QUESTA grigliata, non di una precedente.
  if p_menu_id is null or not exists (
    select 1 from grigliata_menu where id = p_menu_id and evento_id = v_evento_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'scegli un menu');
  end if;

  v_dieta := case when p_dieta in ('vegetariano', 'vegano') then p_dieta else 'classico' end;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 300 then
    return jsonb_build_object('ok', false, 'error', 'nota troppo lunga (massimo 300 caratteri)');
  end if;

  insert into grigliata_adesione (evento_id, room, menu_id, dieta, senza_glutine, note, updated_at)
  values (v_evento_id, p_room, p_menu_id, v_dieta, coalesce(p_senza_glutine, false), v_note, now())
  on conflict (evento_id, room) do update
    set menu_id = excluded.menu_id,
        dieta = excluded.dieta,
        senza_glutine = excluded.senza_glutine,
        note = excluded.note,
        updated_at = now();

  -- Cambiare menu da già confermati cambia i ticket: quelli del menu nuovo.
  perform grigliata_allinea_ticket(v_evento_id);

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function grigliata_usa_ticket(p_room text, p_ticket_id bigint)
returns jsonb language plpgsql as $$
declare
  v_evento_id bigint;
  v_adesione_id bigint;
  v_ticket grigliata_ticket%rowtype;
  v_ticket_nome text;
  v_ticket_emoji text;
  v_numero int;
begin
  select id into v_evento_id from grigliata_evento
    where grigliata_visibile(chiuso, giorno_evento)
    order by created_at desc limit 1;

  if v_evento_id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  select id into v_adesione_id
    from grigliata_adesione where evento_id = v_evento_id and room = p_room;

  if v_adesione_id is null then
    return jsonb_build_object('ok', false, 'error', 'devi prima aderire');
  end if;

  select * into v_ticket from grigliata_ticket where id = p_ticket_id and adesione_id = v_adesione_id;

  if v_ticket.id is null then
    return jsonb_build_object('ok', false, 'error', 'ticket non trovato');
  end if;

  if v_ticket.usato then
    return jsonb_build_object('ok', false, 'error', 'ticket già usato', 'ticket_numero', v_ticket.numero);
  end if;

  -- Prima si "prenota" il ticket (usato = true solo se non lo era già): di
  -- due tocchi quasi simultanei sullo stesso ticket ne passa uno solo.
  update grigliata_ticket set usato = true, usato_at = now()
    where id = v_ticket.id and not usato;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ticket già usato');
  end if;

  update grigliata_evento set ticket_contatore = ticket_contatore + 1
    where id = v_evento_id
    returning ticket_contatore into v_numero;

  update grigliata_ticket set numero = v_numero where id = v_ticket.id;

  select nome, emoji into v_ticket_nome, v_ticket_emoji
    from grigliata_menu_ticket where id = v_ticket.menu_ticket_id;

  return jsonb_build_object('ok', true, 'ticket_numero', v_numero,
                            'ticket_nome', v_ticket_nome, 'ticket_emoji', v_ticket_emoji);
end;
$$;

create or replace function grigliata_admin_crea(
  p_titolo text, p_scadenza timestamptz, p_giorno_evento date, p_paypal text, p_satispay text, p_menu jsonb, p_attore text,
  -- default: il codice già in produzione (che non manda questo parametro)
  -- continua a funzionare fra l'applicazione di questa migrazione e il deploy.
  p_pagamenti_attivi boolean default true,
  p_quota numeric default null
) returns jsonb language plpgsql as $$
declare
  v_id bigint;
  v_paypal text;
  v_satispay text;
  v_errore text;
  v_voce record;
  v_menu_id bigint;
  v_pagamenti boolean := coalesce(p_pagamenti_attivi, true);
begin
  -- La scadenza delle iscrizioni può anche essere già passata (v1.6): serve
  -- solo che ci sia. La visibilità della scheda dipende dal giorno della
  -- grigliata, non da questa.
  if p_scadenza is null then
    return jsonb_build_object('ok', false, 'error', 'indica la scadenza delle iscrizioni');
  end if;

  if p_giorno_evento is null then
    return jsonb_build_object('ok', false, 'error', 'indica il giorno della grigliata');
  end if;

  v_paypal := grigliata_normalizza_link(p_paypal);
  v_satispay := grigliata_normalizza_link(p_satispay);

  if v_pagamenti and v_paypal is null and v_satispay is null then
    return jsonb_build_object('ok', false, 'error', 'inserisci almeno un link per il pagamento (PayPal o Satispay)');
  end if;

  if p_quota is not null and (p_quota < 0 or p_quota > 1000) then
    return jsonb_build_object('ok', false, 'error', 'quota non valida (fra 0 e 1000 €)');
  end if;

  v_errore := grigliata_menu_errore(p_menu);
  if v_errore is not null then
    return jsonb_build_object('ok', false, 'error', v_errore);
  end if;

  update grigliata_evento set chiuso = true where not chiuso;

  insert into grigliata_evento (titolo, creato_da, scadenza, giorno_evento, paypal_link, satispay_link, pagamenti_attivi, quota)
  values (
    coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
    p_attore, p_scadenza, p_giorno_evento, v_paypal, v_satispay, v_pagamenti, round(p_quota, 2)
  )
  returning id into v_id;

  -- Un evento nuovo non ha menu (né voci-ticket) esistenti: un ciclo, non
  -- un'unica INSERT...SELECT, perché ogni menu appena creato deve portare
  -- subito le proprie voci — serve il suo id, che solo RETURNING dà.
  for v_voce in select e.value, e.ordinality from jsonb_array_elements(p_menu) with ordinality as e(value, ordinality) loop
    insert into grigliata_menu (evento_id, nome, posizione)
    values (v_id, btrim(v_voce.value->>'nome'), v_voce.ordinality - 1)
    returning id into v_menu_id;

    insert into grigliata_menu_ticket (menu_id, nome, emoji, posizione)
    select v_menu_id, btrim(t.value->>'nome'), nullif(btrim(coalesce(t.value->>'emoji', '')), ''), t.ordinality - 1
    from jsonb_array_elements(v_voce.value->'ticket') with ordinality as t(value, ordinality);
  end loop;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function grigliata_admin_modifica(
  p_evento_id bigint, p_titolo text, p_scadenza timestamptz, p_giorno_evento date, p_menu jsonb
) returns jsonb language plpgsql as $$
declare
  v_errore text;
  v_nome text;
  v_quante int;
  v_voce record;
begin
  -- La scadenza delle iscrizioni può anche essere già passata (v1.6): serve
  -- solo che ci sia. La visibilità della scheda dipende dal giorno della
  -- grigliata, non da questa.
  if p_scadenza is null then
    return jsonb_build_object('ok', false, 'error', 'indica la scadenza delle iscrizioni');
  end if;

  if p_giorno_evento is null then
    return jsonb_build_object('ok', false, 'error', 'indica il giorno della grigliata');
  end if;

  if not exists (select 1 from grigliata_evento where id = p_evento_id) then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;

  v_errore := grigliata_menu_errore(p_menu);
  if v_errore is not null then
    return jsonb_build_object('ok', false, 'error', v_errore);
  end if;

  -- Un id che non appartiene a QUESTO evento non si rinomina: sarebbe un
  -- menu di un'altra grigliata.
  if exists (
    select 1 from jsonb_array_elements(p_menu) e
    where e.value->>'id' is not null
      and not exists (select 1 from grigliata_menu m where m.id = (e.value->>'id')::bigint and m.evento_id = p_evento_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'menu non valido');
  end if;

  -- Un menu tolto dall'elenco che qualche camera ha già scelto: si rifiuta
  -- invece di lasciare adesioni senza menu. Il delegato può rinominarlo, o
  -- prima spostare quelle camere su un altro menu.
  select m.nome, count(*) into v_nome, v_quante
  from grigliata_menu m
  join grigliata_adesione a on a.menu_id = m.id
  where m.evento_id = p_evento_id
    and m.id not in (
      select (e.value->>'id')::bigint from jsonb_array_elements(p_menu) e where e.value->>'id' is not null
    )
  group by m.id, m.nome
  limit 1;

  if v_nome is not null then
    return jsonb_build_object('ok', false, 'error',
      format('il menu "%s" è già stato scelto da %s %s: non si può togliere', v_nome, v_quante,
             case when v_quante = 1 then 'camera' else 'camere' end));
  end if;

  -- Una voce-ticket tolta da un menu ESISTENTE che qualcuno ha già USATO al
  -- banco si rifiuta allo stesso modo — sparirebbe la traccia di cosa è
  -- stato servito. Se invece i suoi ticket sono solo assegnati e non ancora
  -- usati, la voce si toglie e quei ticket con lei (più sotto).
  for v_voce in select e.value from jsonb_array_elements(p_menu) e where e.value->>'id' is not null loop
    select t.nome, count(gt.id) into v_nome, v_quante
    from grigliata_menu_ticket t
    join grigliata_ticket gt on gt.menu_ticket_id = t.id and gt.usato
    where t.menu_id = (v_voce.value->>'id')::bigint
      and t.id not in (
        select (e2.value->>'id')::bigint
        from jsonb_array_elements(v_voce.value->'ticket') e2
        where e2.value->>'id' is not null
      )
    group by t.id, t.nome
    limit 1;

    if v_nome is not null then
      return jsonb_build_object('ok', false, 'error',
        format('il ticket "%s" è già stato ritirato %s %s: non si può togliere', v_nome, v_quante,
               case when v_quante = 1 then 'volta' else 'volte' end));
    end if;
  end loop;

  update grigliata_evento
    set titolo = coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
        scadenza = p_scadenza,
        giorno_evento = p_giorno_evento
    where id = p_evento_id;

  delete from grigliata_menu m
  where m.evento_id = p_evento_id
    and m.id not in (
      select (e.value->>'id')::bigint from jsonb_array_elements(p_menu) e where e.value->>'id' is not null
    );

  -- Due passaggi per i nomi: prima un nome provvisorio unico, poi quello
  -- vero — altrimenti scambiare due nomi fra loro ("A"↔"B") violerebbe
  -- per un istante il vincolo di unicità a metà dell'aggiornamento.
  update grigliata_menu set nome = '#' || id where evento_id = p_evento_id;

  update grigliata_menu m
    set nome = btrim(e.value->>'nome'), posizione = e.ordinality - 1
  from jsonb_array_elements(p_menu) with ordinality as e(value, ordinality)
  where e.value->>'id' is not null and m.id = (e.value->>'id')::bigint;

  insert into grigliata_menu (evento_id, nome, posizione)
  select p_evento_id, btrim(e.value->>'nome'), e.ordinality - 1
  from jsonb_array_elements(p_menu) with ordinality as e(value, ordinality)
  where e.value->>'id' is null;

  -- Ora che ogni menu del payload corrisponde a una riga vera (esistente o
  -- appena creata, e con il nome finale — il passaggio sopra lo garantisce),
  -- si sincronizzano le sue voci-ticket: stesso schema a due passaggi per i
  -- nomi, un livello più in basso. Il nome è univoco per evento (vincolo
  -- grigliata_menu_nome_unico), quindi il join è affidabile.
  for v_voce in
    select e.value, m.id as menu_id
    from jsonb_array_elements(p_menu) e
    join grigliata_menu m on m.evento_id = p_evento_id and m.nome = btrim(e.value->>'nome')
  loop
    -- Prima i ticket (non usati: quelli usati hanno già bloccato tutto più
    -- sopra) delle voci che stanno per sparire, o il vincolo di chiave
    -- esterna impedirebbe di togliere la voce.
    delete from grigliata_ticket gt
    using grigliata_menu_ticket t
    where gt.menu_ticket_id = t.id and t.menu_id = v_voce.menu_id and not gt.usato
      and t.id not in (
        select (e2.value->>'id')::bigint from jsonb_array_elements(v_voce.value->'ticket') e2
        where e2.value->>'id' is not null
      );

    delete from grigliata_menu_ticket t
    where t.menu_id = v_voce.menu_id
      and t.id not in (
        select (e2.value->>'id')::bigint from jsonb_array_elements(v_voce.value->'ticket') e2
        where e2.value->>'id' is not null
      );

    update grigliata_menu_ticket set nome = '#' || id where menu_id = v_voce.menu_id;

    update grigliata_menu_ticket t
      set nome = btrim(e2.value->>'nome'),
          emoji = nullif(btrim(coalesce(e2.value->>'emoji', '')), ''),
          posizione = e2.ordinality - 1
    from jsonb_array_elements(v_voce.value->'ticket') with ordinality as e2(value, ordinality)
    where e2.value->>'id' is not null and t.id = (e2.value->>'id')::bigint;

    insert into grigliata_menu_ticket (menu_id, nome, emoji, posizione)
    select v_voce.menu_id, btrim(e2.value->>'nome'), nullif(btrim(coalesce(e2.value->>'emoji', '')), ''), e2.ordinality - 1
    from jsonb_array_elements(v_voce.value->'ticket') with ordinality as e2(value, ordinality)
    where e2.value->>'id' is null;
  end loop;

  -- Una voce aggiunta a un menu arriva SUBITO a chi è già confermato.
  perform grigliata_allinea_ticket(p_evento_id);

  return jsonb_build_object('ok', true, 'scadenza', p_scadenza);
end;
$$;

create or replace function grigliata_admin_overview()
returns jsonb language plpgsql stable as $$
declare
  v_evento grigliata_evento%rowtype;
begin
  select * into v_evento from grigliata_evento order by created_at desc limit 1;

  if v_evento.id is null then
    return jsonb_build_object('ok', true, 'evento', null, 'adesioni', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'evento', jsonb_build_object(
      'id', v_evento.id, 'titolo', v_evento.titolo, 'scadenza', v_evento.scadenza,
      'giorno_evento', v_evento.giorno_evento,
      'pagamenti_attivi', v_evento.pagamenti_attivi, 'quota', v_evento.quota,
      'paypal_link', v_evento.paypal_link, 'satispay_link', v_evento.satispay_link,
      'chiuso', v_evento.chiuso, 'attiva', grigliata_visibile(v_evento.chiuso, v_evento.giorno_evento),
      'iscrizioni_aperte', now() < v_evento.scadenza,
      'menu', grigliata_menu_di(v_evento.id)
    ),
    'adesioni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'room', a.room, 'menu_id', a.menu_id, 'dieta', a.dieta,
        'senza_glutine', a.senza_glutine, 'note', a.note,
        'pagamento_dichiarato', a.pagamento_dichiarato, 'pagamento_confermato', a.pagamento_confermato,
        'confermato_da', a.confermato_da, 'confermato_at', a.confermato_at,
        'ticket', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', gt.id, 'menu_ticket_id', gt.menu_ticket_id,
            'nome', mt.nome, 'emoji', mt.emoji, 'usato', gt.usato, 'numero', gt.numero, 'usato_at', gt.usato_at
          ) order by mt.posizione, mt.id)
          from grigliata_ticket gt
          join grigliata_menu_ticket mt on mt.id = gt.menu_ticket_id
          where gt.adesione_id = a.id
        ), '[]'::jsonb)
      ) order by a.room)
      from grigliata_adesione a where a.evento_id = v_evento.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function grigliata_admin_conferma_pagamento(p_adesione_id bigint, p_attore text)
returns jsonb language plpgsql as $$
declare
  v_room text;
  v_titolo text;
  v_evento_id bigint;
begin
  update grigliata_adesione a
  set pagamento_confermato = true, confermato_da = p_attore, confermato_at = now(), updated_at = now()
  from grigliata_evento e
  where a.id = p_adesione_id and e.id = a.evento_id
  returning a.room, e.titolo, a.evento_id into v_room, v_titolo, v_evento_id;

  if v_room is null then
    return jsonb_build_object('ok', false, 'error', 'adesione non trovata');
  end if;

  perform grigliata_allinea_ticket(v_evento_id);

  return jsonb_build_object('ok', true, 'room', v_room, 'titolo', v_titolo);
end;
$$;

create or replace function grigliata_admin_annulla_conferma_pagamento(p_adesione_id bigint)
returns jsonb language plpgsql as $$
declare
  v_room text;
begin
  delete from grigliata_ticket where adesione_id = p_adesione_id;

  update grigliata_adesione
    set pagamento_confermato = false, confermato_da = null, confermato_at = null, updated_at = now()
    where id = p_adesione_id
    returning room into v_room;

  if v_room is null then
    return jsonb_build_object('ok', false, 'error', 'adesione non trovata');
  end if;

  return jsonb_build_object('ok', true, 'room', v_room);
end;
$$;

create or replace function grigliata_admin_ripristina_ticket(p_ticket_id bigint)
returns jsonb language plpgsql as $$
begin
  update grigliata_ticket set usato = false, numero = null, usato_at = null
    where id = p_ticket_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ticket non trovato');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function grigliata_admin_aggiungi_adesione(
  p_evento_id bigint, p_room text, p_menu_id bigint, p_dieta text
) returns jsonb language plpgsql as $$
declare
  v_dieta text;
begin
  if not exists (select 1 from grigliata_evento where id = p_evento_id) then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;
  if p_room is null or btrim(p_room) = '' then
    return jsonb_build_object('ok', false, 'error', 'camera mancante');
  end if;
  if p_menu_id is null or not exists (
    select 1 from grigliata_menu where id = p_menu_id and evento_id = p_evento_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'scegli un menu');
  end if;

  v_dieta := case when p_dieta in ('vegetariano', 'vegano') then p_dieta else 'classico' end;

  insert into grigliata_adesione (evento_id, room, menu_id, dieta, updated_at)
  values (p_evento_id, btrim(p_room), p_menu_id, v_dieta, now())
  on conflict (evento_id, room) do update
    set menu_id = excluded.menu_id, dieta = excluded.dieta, updated_at = now();

  perform grigliata_allinea_ticket(p_evento_id);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function grigliata_allinea_ticket(bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_annulla_conferma_pagamento(bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_ripristina_ticket(bigint) from public, anon, authenticated;
grant execute on function grigliata_allinea_ticket(bigint) to service_role;
grant execute on function grigliata_admin_annulla_conferma_pagamento(bigint) to service_role;
grant execute on function grigliata_admin_ripristina_ticket(bigint) to service_role;

select grigliata_allinea_ticket(id) from grigliata_evento;
