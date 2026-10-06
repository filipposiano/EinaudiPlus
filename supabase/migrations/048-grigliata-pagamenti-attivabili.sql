-- v1.4: i pagamenti della grigliata si possono attivare o disattivare a
-- piacimento dal delegato — alla creazione e in qualunque momento dopo. Una
-- grigliata "offerta" (o pagata in contanti sul posto) non ha bisogno di
-- link né di "Ho pagato": con i pagamenti disattivati la scheda residenti
-- non mostra la sezione di pagamento, e il pannello non colora le pastiglie
-- in base all'incasso.
--
-- SOLO ADDITIVA, nessun dato esistente cambia:
--   · grigliata_evento guadagna una colonna con default TRUE — ogni
--     grigliata già esistente continua esattamente come prima (pagamenti
--     attivi, stessi link);
--   · grigliata_adesione NON si tocca: menu, dieta, senza glutine, note e i
--     flag di pagamento di chi ha già risposto restano tali e quali.
--     Disattivare i pagamenti NASCONDE i flag, non li azzera: riattivandoli
--     ricompaiono le conferme già date.
--
-- Consolidato in supabase/grigliata.sql; qui la versione da applicare a un
-- database già in produzione (dopo la 047).

alter table grigliata_evento add column if not exists pagamenti_attivi boolean not null default true;

-- grigliata_admin_crea guadagna un parametro: firma diversa, va tolta prima
-- di ricrearla (stesso principio della 045/046/047).
drop function if exists grigliata_admin_crea(text, timestamptz, text, text, jsonb, text);

-- I link diventano obbligatori SOLO se i pagamenti sono attivi.
create or replace function grigliata_admin_crea(
  p_titolo text, p_scadenza timestamptz, p_paypal text, p_satispay text, p_menu jsonb, p_attore text,
  -- default: il codice già in produzione (che non manda questo parametro)
  -- continua a funzionare fra l'applicazione di questa migrazione e il deploy.
  p_pagamenti_attivi boolean default true
) returns jsonb language plpgsql as $$
declare
  v_id bigint;
  v_paypal text;
  v_satispay text;
  v_errore text;
  v_pagamenti boolean := coalesce(p_pagamenti_attivi, true);
begin
  if p_scadenza is null or p_scadenza <= now() then
    return jsonb_build_object('ok', false, 'error', 'la scadenza deve essere nel futuro');
  end if;

  v_paypal := grigliata_normalizza_link(p_paypal);
  v_satispay := grigliata_normalizza_link(p_satispay);

  if v_pagamenti and v_paypal is null and v_satispay is null then
    return jsonb_build_object('ok', false, 'error', 'inserisci almeno un link per il pagamento (PayPal o Satispay)');
  end if;

  v_errore := grigliata_menu_errore(p_menu);
  if v_errore is not null then
    return jsonb_build_object('ok', false, 'error', v_errore);
  end if;

  update grigliata_evento set chiuso = true where not chiuso;

  insert into grigliata_evento (titolo, creato_da, scadenza, paypal_link, satispay_link, pagamenti_attivi)
  values (
    coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
    p_attore, p_scadenza, v_paypal, v_satispay, v_pagamenti
  )
  returning id into v_id;

  insert into grigliata_menu (evento_id, nome, posizione)
  select v_id, btrim(e.value->>'nome'), e.ordinality - 1
  from jsonb_array_elements(p_menu) with ordinality as e(value, ordinality);

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Attiva/disattiva i pagamenti di un evento esistente, e ne aggiorna i
-- link. Un link passato null o vuoto NON cancella quello salvato: così
-- spegnere e riaccendere non chiede di riscriverli. Riattivare un evento
-- che non ha nessun link (creato con i pagamenti spenti) li richiede.
create or replace function grigliata_admin_imposta_pagamenti(
  p_evento_id bigint, p_attivi boolean, p_paypal text, p_satispay text
) returns jsonb language plpgsql as $$
declare
  v_evento grigliata_evento%rowtype;
  v_paypal text;
  v_satispay text;
begin
  select * into v_evento from grigliata_evento where id = p_evento_id;
  if v_evento.id is null then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;

  v_paypal := coalesce(grigliata_normalizza_link(p_paypal), v_evento.paypal_link);
  v_satispay := coalesce(grigliata_normalizza_link(p_satispay), v_evento.satispay_link);

  if coalesce(p_attivi, false) and v_paypal is null and v_satispay is null then
    return jsonb_build_object('ok', false, 'error', 'inserisci almeno un link per il pagamento (PayPal o Satispay)');
  end if;

  update grigliata_evento
    set pagamenti_attivi = coalesce(p_attivi, false), paypal_link = v_paypal, satispay_link = v_satispay
    where id = p_evento_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Stessa firma: basta create or replace. Aggiunge solo 'pagamenti_attivi'.
create or replace function grigliata_stato_pubblico(p_room text)
returns jsonb language plpgsql stable as $$
declare
  v_evento grigliata_evento%rowtype;
  v_adesione grigliata_adesione%rowtype;
begin
  select * into v_evento from grigliata_evento
    where not chiuso and now() < scadenza
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
      'pagamenti_attivi', v_evento.pagamenti_attivi,
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
      'pagamento_confermato', v_adesione.pagamento_confermato
    ) end
  );
end;
$$;

-- "Ho pagato" con i pagamenti disattivati: rifiutato (la scheda non mostra
-- il pulsante, ma un client vecchio in cache potrebbe ancora averlo).
create or replace function grigliata_dichiara_pagamento(p_room text)
returns jsonb language plpgsql as $$
declare
  v_evento grigliata_evento%rowtype;
  v_id bigint;
begin
  select * into v_evento from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento.id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  if not v_evento.pagamenti_attivi then
    return jsonb_build_object('ok', false, 'error', 'i pagamenti non sono attivi per questa grigliata');
  end if;

  select id into v_id
    from grigliata_adesione where evento_id = v_evento.id and room = p_room;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'devi prima aderire');
  end if;

  update grigliata_adesione set pagamento_dichiarato = true, updated_at = now() where id = v_id;
  return jsonb_build_object('ok', true);
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
      'pagamenti_attivi', v_evento.pagamenti_attivi,
      'paypal_link', v_evento.paypal_link, 'satispay_link', v_evento.satispay_link,
      'chiuso', v_evento.chiuso, 'attiva', (not v_evento.chiuso and now() < v_evento.scadenza),
      'menu', grigliata_menu_di(v_evento.id)
    ),
    'adesioni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'room', a.room, 'menu_id', a.menu_id, 'dieta', a.dieta,
        'senza_glutine', a.senza_glutine, 'note', a.note,
        'pagamento_dichiarato', a.pagamento_dichiarato, 'pagamento_confermato', a.pagamento_confermato,
        'confermato_da', a.confermato_da, 'confermato_at', a.confermato_at
      ) order by a.room)
      from grigliata_adesione a where a.evento_id = v_evento.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function grigliata_admin_crea(text, timestamptz, text, text, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function grigliata_admin_imposta_pagamenti(bigint, boolean, text, text) from public, anon, authenticated;

grant execute on function grigliata_admin_crea(text, timestamptz, text, text, jsonb, text, boolean) to service_role;
grant execute on function grigliata_admin_imposta_pagamenti(bigint, boolean, text, text) to service_role;
