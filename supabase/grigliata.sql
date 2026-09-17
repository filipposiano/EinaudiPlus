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
-- Grigliata: il delegato fa partire un evento (titolo, scadenza, link di
-- pagamento), i residenti aderiscono e scelgono il menu, dichiarano di aver
-- pagato, il delegato conferma. Percorso pubblico per i residenti (camera
-- autodichiarata, stesso modello di fiducia di tutto il resto dell'app) e
-- amministrativo per creare/chiudere l'evento e confermare i pagamenti —
-- vedi src/modules/grigliata/domain/policy.js: riservato a delegato e
-- sistemista, non a FDO/staff.
--
-- UNA grigliata alla volta: farne partire una nuova chiude automaticamente
-- quella ancora attiva (grigliata_admin_crea), così la scheda residenti non
-- deve mai scegliere fra due eventi contemporanei.

create table if not exists grigliata_evento (
  id            bigserial primary key,
  titolo        text not null default 'Grigliata',
  creato_da     text not null,
  scadenza      timestamptz not null,
  paypal_link   text,
  satispay_link text,
  -- Disattivata invece di cancellata, come le regole ricorrenti e gli
  -- account: un evento passato resta nella dashboard del delegato (l'ultimo,
  -- se non ce n'è uno attivo) invece di sparire senza lasciare traccia.
  chiuso        boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists grigliata_adesione (
  id                   bigserial primary key,
  evento_id            bigint not null references grigliata_evento(id) on delete cascade,
  -- Come ogni altra identità in quest'app: la camera è autodichiarata, non
  -- verificata (vedi README, "L'identità è autodichiarata").
  room                 text not null,
  partecipa            boolean not null,
  -- null per chi non partecipa: non ha un menu da ricordare (vedi
  -- src/modules/grigliata/application/iscriviti.js, che lo azzera prima
  -- ancora di arrivare qui).
  menu                 text check (menu in ('classico', 'vegano')),
  pagamento_dichiarato boolean not null default false,
  pagamento_confermato boolean not null default false,
  confermato_da        text,
  confermato_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Un'adesione per camera per evento: aderire di nuovo aggiorna la
  -- precedente (upsert in grigliata_iscrivi), non ne crea una seconda.
  unique (evento_id, room)
);

alter table grigliata_evento enable row level security;
alter table grigliata_adesione enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Percorso pubblico (residenti)
-- ─────────────────────────────────────────────────────────────────────────────

-- Solo il booleano, non l'evento intero: è quello che laundry_snapshot
-- incorpora (vedi functions.sql) per decidere se mostrare la scheda
-- "Grigliata" in navigazione, con la stessa cadenza di aggiornamento di tema
-- e cambio biancheria — nessun canale a parte, nessun altro giro di rete.
-- Il contenuto vero (evento, link di pagamento, la propria adesione) resta
-- dietro grigliata_stato_pubblico(), che la scheda stessa chiama quando si
-- apre.
create or replace function grigliata_attiva_bool()
returns boolean language sql stable as $$
  select exists (select 1 from grigliata_evento where not chiuso and now() < scadenza);
$$;

-- Cosa vede un residente: se c'è una grigliata attiva, i suoi dati, e la
-- propria adesione se ne ha già fatta una. 'attiva' e non chiusa e non
-- scaduta — le stesse due condizioni ripetute in ogni funzione qui sotto
-- che deve decidere "quale evento conta adesso".
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
      'paypal_link', v_evento.paypal_link,
      'satispay_link', v_evento.satispay_link
    ),
    'mia_adesione', case when v_adesione.id is null then null else jsonb_build_object(
      'partecipa', v_adesione.partecipa,
      'menu', v_adesione.menu,
      'pagamento_dichiarato', v_adesione.pagamento_dichiarato,
      'pagamento_confermato', v_adesione.pagamento_confermato
    ) end
  );
end;
$$;

-- Aderisce o declina, con il menu se partecipa. Upsert: aderire due volte
-- aggiorna la stessa riga, non ne crea una seconda (vedi il vincolo unique
-- sulla tabella). I flag di pagamento NON si toccano qui apposta: cambiare
-- idea sulla partecipazione non deve far sparire in silenzio una conferma
-- di pagamento già data dal delegato.
create or replace function grigliata_iscrivi(p_room text, p_partecipa boolean, p_menu text)
returns jsonb language plpgsql as $$
declare
  v_evento_id bigint;
  v_menu text;
begin
  select id into v_evento_id from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento_id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  v_menu := nullif(btrim(coalesce(p_menu, '')), '');
  if p_partecipa and (v_menu is null or v_menu not in ('classico', 'vegano')) then
    return jsonb_build_object('ok', false, 'error', 'scegli un menu');
  end if;
  if not p_partecipa then
    v_menu := null;
  end if;

  insert into grigliata_adesione (evento_id, room, partecipa, menu, updated_at)
  values (v_evento_id, p_room, p_partecipa, v_menu, now())
  on conflict (evento_id, room) do update
    set partecipa = excluded.partecipa,
        menu = excluded.menu,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

-- "Ho pagato": non conferma nulla da sola, dice solo che il residente
-- afferma di aver inviato la quota. La conferma vera è amministrativa (vedi
-- grigliata_admin_conferma_pagamento più sotto).
create or replace function grigliata_dichiara_pagamento(p_room text)
returns jsonb language plpgsql as $$
declare
  v_evento_id bigint;
  v_id bigint;
  v_partecipa boolean;
begin
  select id into v_evento_id from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento_id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  select id, partecipa into v_id, v_partecipa
    from grigliata_adesione where evento_id = v_evento_id and room = p_room;

  if v_id is null or not v_partecipa then
    return jsonb_build_object('ok', false, 'error', 'devi prima aderire');
  end if;

  update grigliata_adesione set pagamento_dichiarato = true, updated_at = now() where id = v_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Percorso amministrativo (delegato, sistemista)
-- ─────────────────────────────────────────────────────────────────────────────

-- Fa partire una nuova grigliata. Chiude da sola qualunque evento ancora
-- attivo prima di crearne uno: una alla volta, sempre — la scheda residenti
-- non deve mai scegliere fra due.
create or replace function grigliata_admin_crea(
  p_titolo text, p_scadenza timestamptz, p_paypal text, p_satispay text, p_attore text
) returns jsonb language plpgsql as $$
declare
  v_id bigint;
begin
  if p_scadenza is null or p_scadenza <= now() then
    return jsonb_build_object('ok', false, 'error', 'la scadenza deve essere nel futuro');
  end if;

  if nullif(btrim(coalesce(p_paypal, '')), '') is null
     and nullif(btrim(coalesce(p_satispay, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'inserisci almeno un link per il pagamento (PayPal o Satispay)');
  end if;

  update grigliata_evento set chiuso = true where not chiuso;

  insert into grigliata_evento (titolo, creato_da, scadenza, paypal_link, satispay_link)
  values (
    coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
    p_attore, p_scadenza,
    nullif(btrim(coalesce(p_paypal, '')), ''),
    nullif(btrim(coalesce(p_satispay, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- La dashboard del delegato: l'evento più recente (attivo o l'ultimo
-- chiuso — non uno storico di tutti, solo l'ultimo: un delegato lavora su
-- una grigliata alla volta) e tutte le adesioni, con menu e stato del
-- pagamento di ciascuna.
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
      'paypal_link', v_evento.paypal_link, 'satispay_link', v_evento.satispay_link,
      'chiuso', v_evento.chiuso, 'attiva', (not v_evento.chiuso and now() < v_evento.scadenza)
    ),
    'adesioni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'room', a.room, 'partecipa', a.partecipa, 'menu', a.menu,
        'pagamento_dichiarato', a.pagamento_dichiarato, 'pagamento_confermato', a.pagamento_confermato,
        'confermato_da', a.confermato_da, 'confermato_at', a.confermato_at
      ) order by a.room)
      from grigliata_adesione a where a.evento_id = v_evento.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Conferma il pagamento di UNA adesione. Torna room + titolo dell'evento:
-- non per il client (che si ferma a {ok}), ma per lo strato JS
-- (adminConfermaPagamento.js), che li usa per notificare la camera —
-- questa funzione non sa nulla di push o Telegram, quello è compito del
-- modulo Notifications, chiamato da fuori.
create or replace function grigliata_admin_conferma_pagamento(p_adesione_id bigint, p_attore text)
returns jsonb language plpgsql as $$
declare
  v_room text;
  v_titolo text;
begin
  update grigliata_adesione a
  set pagamento_confermato = true, confermato_da = p_attore, confermato_at = now(), updated_at = now()
  from grigliata_evento e
  where a.id = p_adesione_id and e.id = a.evento_id
  returning a.room, e.titolo into v_room, v_titolo;

  if v_room is null then
    return jsonb_build_object('ok', false, 'error', 'adesione non trovata');
  end if;

  return jsonb_build_object('ok', true, 'room', v_room, 'titolo', v_titolo);
end;
$$;

-- Chiude un evento a mano, prima della scadenza naturale.
create or replace function grigliata_admin_chiudi(p_evento_id bigint)
returns jsonb language plpgsql as $$
begin
  update grigliata_evento set chiuso = true where id = p_evento_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permessi
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function grigliata_attiva_bool() from public, anon, authenticated;
revoke all on function grigliata_stato_pubblico(text) from public, anon, authenticated;
revoke all on function grigliata_iscrivi(text, boolean, text) from public, anon, authenticated;
revoke all on function grigliata_dichiara_pagamento(text) from public, anon, authenticated;
revoke all on function grigliata_admin_crea(text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function grigliata_admin_overview() from public, anon, authenticated;
revoke all on function grigliata_admin_conferma_pagamento(bigint, text) from public, anon, authenticated;
revoke all on function grigliata_admin_chiudi(bigint) from public, anon, authenticated;

grant execute on function grigliata_attiva_bool() to service_role;
grant execute on function grigliata_stato_pubblico(text) to service_role;
grant execute on function grigliata_iscrivi(text, boolean, text) to service_role;
grant execute on function grigliata_dichiara_pagamento(text) to service_role;
grant execute on function grigliata_admin_crea(text, timestamptz, text, text, text) to service_role;
grant execute on function grigliata_admin_overview() to service_role;
grant execute on function grigliata_admin_conferma_pagamento(bigint, text) to service_role;
grant execute on function grigliata_admin_chiudi(bigint) to service_role;
