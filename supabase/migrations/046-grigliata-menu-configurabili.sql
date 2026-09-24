-- v1.3: i menu della grigliata non sono più un elenco fisso (mangio tutto /
-- vegetariano / vegano) ma li decide il delegato, per ogni grigliata, quando
-- la crea — e può aggiungerne, rinominarli o toglierli dopo. Il PRIMO
-- dell'elenco è quello "di base": nel pannello non viene segnato sulle
-- pastiglie, si segnano solo i casi diversi.
--
-- Un menu è una riga di grigliata_menu, e un'adesione lo indica per id (non
-- per nome): così rinominare un menu non stacca le camere che l'avevano già
-- scelto, e togliere un menu che qualcuno ha scelto viene rifiutato invece
-- di lasciare adesioni orfane.
--
-- Consolidato in supabase/grigliata.sql; qui la versione da applicare a un
-- database già in produzione (dopo la 045).

create table if not exists grigliata_menu (
  id         bigserial primary key,
  evento_id  bigint not null references grigliata_evento(id) on delete cascade,
  nome       text not null check (char_length(btrim(nome)) between 1 and 40),
  posizione  int not null default 0
);
create unique index if not exists grigliata_menu_nome_unico on grigliata_menu (evento_id, lower(nome));
alter table grigliata_menu enable row level security;

-- Le grigliate già esistenti ricevono i tre menu che prima erano fissi, e le
-- loro adesioni vengono agganciate a quello corrispondente — nessuna scelta
-- già fatta va persa nel passaggio.
insert into grigliata_menu (evento_id, nome, posizione)
select e.id, m.nome, m.posizione
from grigliata_evento e
cross join (values ('Mangio tutto', 0), ('Vegetariano', 1), ('Vegano', 2)) as m(nome, posizione)
where not exists (select 1 from grigliata_menu x where x.evento_id = e.id);

-- `no action` (il default) e non `restrict`: eliminare un evento cancella a
-- cascata sia i menu sia le adesioni nella stessa istruzione, e `restrict`
-- fallirebbe se il menu se ne andasse prima dell'adesione che lo indica
-- (vedi il commento gemello in grigliata.sql).
alter table grigliata_adesione add column if not exists menu_id bigint references grigliata_menu(id);

-- `else 0`: un valore che non fosse nessuno dei tre (non dovrebbe esistere,
-- c'era un check — ma una riga orfana farebbe fallire il `set not null`
-- qui sotto, e con lui l'intera migrazione) finisce su quello di base.
update grigliata_adesione a
set menu_id = m.id
from grigliata_menu m
where a.menu_id is null
  and m.evento_id = a.evento_id
  and m.posizione = case a.menu when 'vegetariano' then 1 when 'vegano' then 2 else 0 end;

alter table grigliata_adesione alter column menu_id set not null;
alter table grigliata_adesione drop constraint if exists grigliata_adesione_menu_check;
alter table grigliata_adesione drop column if exists menu;

-- Le quattro funzioni che cambiano firma vanno tolte prima di ricrearle
-- (CREATE OR REPLACE richiede la stessa identica lista di parametri).
drop function if exists grigliata_admin_crea(text, timestamptz, text, text, text);
drop function if exists grigliata_admin_modifica(bigint, text, timestamptz);
drop function if exists grigliata_iscrivi(text, text, boolean, text);
drop function if exists grigliata_admin_aggiungi_adesione(bigint, text, text);

-- L'elenco dei menu è valido? Torna il messaggio d'errore, o null se va
-- bene. Usata sia da grigliata_admin_crea sia da grigliata_admin_modifica,
-- così le regole sono scritte una volta sola (le stesse di controllaMenu()
-- in src/modules/grigliata/domain/validazione.js).
create or replace function grigliata_menu_errore(p_menu jsonb)
returns text language plpgsql immutable as $$
declare
  v_voce jsonb;
  v_nome text;
  v_visti text[] := '{}';
  v_ids text[] := '{}';
begin
  if p_menu is null or jsonb_typeof(p_menu) <> 'array' then
    return 'menu non valido';
  end if;
  if jsonb_array_length(p_menu) < 1 then
    return 'serve almeno un menu';
  end if;
  if jsonb_array_length(p_menu) > 10 then
    return 'al massimo 10 menu';
  end if;

  for v_voce in select value from jsonb_array_elements(p_menu) loop
    v_nome := btrim(coalesce(v_voce->>'nome', ''));
    if v_nome = '' then
      return 'ogni menu deve avere un nome';
    end if;
    if char_length(v_nome) > 40 then
      return 'nome del menu troppo lungo (massimo 40 caratteri)';
    end if;
    if lower(v_nome) = any(v_visti) then
      return 'due menu con lo stesso nome: ' || v_nome;
    end if;
    v_visti := v_visti || lower(v_nome);
    -- Lo stesso menu esistente elencato due volte: uno dei due nomi
    -- sparirebbe in silenzio.
    if v_voce->>'id' is not null then
      if (v_voce->>'id') = any(v_ids) then
        return 'menu non valido';
      end if;
      v_ids := v_ids || (v_voce->>'id');
    end if;
  end loop;

  return null;
end;
$$;

-- I menu di un evento, nell'ordine scelto dal delegato — la forma che
-- stato_pubblico e admin_overview restituiscono entrambi.
create or replace function grigliata_menu_di(p_evento_id bigint)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome) order by m.posizione, m.id), '[]'::jsonb)
  from grigliata_menu m where m.evento_id = p_evento_id;
$$;

create or replace function grigliata_admin_crea(
  p_titolo text, p_scadenza timestamptz, p_paypal text, p_satispay text, p_menu jsonb, p_attore text
) returns jsonb language plpgsql as $$
declare
  v_id bigint;
  v_paypal text;
  v_satispay text;
  v_errore text;
begin
  if p_scadenza is null or p_scadenza <= now() then
    return jsonb_build_object('ok', false, 'error', 'la scadenza deve essere nel futuro');
  end if;

  v_paypal := grigliata_normalizza_link(p_paypal);
  v_satispay := grigliata_normalizza_link(p_satispay);

  if v_paypal is null and v_satispay is null then
    return jsonb_build_object('ok', false, 'error', 'inserisci almeno un link per il pagamento (PayPal o Satispay)');
  end if;

  v_errore := grigliata_menu_errore(p_menu);
  if v_errore is not null then
    return jsonb_build_object('ok', false, 'error', v_errore);
  end if;

  update grigliata_evento set chiuso = true where not chiuso;

  insert into grigliata_evento (titolo, creato_da, scadenza, paypal_link, satispay_link)
  values (
    coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
    p_attore, p_scadenza, v_paypal, v_satispay
  )
  returning id into v_id;

  insert into grigliata_menu (evento_id, nome, posizione)
  select v_id, btrim(e.value->>'nome'), e.ordinality - 1
  from jsonb_array_elements(p_menu) with ordinality as e(value, ordinality);

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function grigliata_admin_modifica(
  p_evento_id bigint, p_titolo text, p_scadenza timestamptz, p_menu jsonb
) returns jsonb language plpgsql as $$
declare
  v_errore text;
  v_nome text;
  v_quante int;
begin
  if p_scadenza is null or p_scadenza <= now() then
    return jsonb_build_object('ok', false, 'error', 'la scadenza deve essere nel futuro');
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

  update grigliata_evento
    set titolo = coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
        scadenza = p_scadenza
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

  return jsonb_build_object('ok', true, 'scadenza', p_scadenza);
end;
$$;

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
      'satispay_link', v_evento.satispay_link,
      'menu', grigliata_menu_di(v_evento.id)
    ),
    'mia_adesione', case when v_adesione.id is null then null else jsonb_build_object(
      'menu_id', v_adesione.menu_id,
      'senza_glutine', v_adesione.senza_glutine,
      'note', v_adesione.note,
      'pagamento_dichiarato', v_adesione.pagamento_dichiarato,
      'pagamento_confermato', v_adesione.pagamento_confermato
    ) end
  );
end;
$$;

create or replace function grigliata_iscrivi(p_room text, p_menu_id bigint, p_senza_glutine boolean, p_note text)
returns jsonb language plpgsql as $$
declare
  v_evento_id bigint;
  v_note text;
begin
  select id into v_evento_id from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento_id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  -- Il menu deve essere uno di QUESTA grigliata, non di una precedente.
  if p_menu_id is null or not exists (
    select 1 from grigliata_menu where id = p_menu_id and evento_id = v_evento_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'scegli un menu');
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 300 then
    return jsonb_build_object('ok', false, 'error', 'nota troppo lunga (massimo 300 caratteri)');
  end if;

  insert into grigliata_adesione (evento_id, room, menu_id, senza_glutine, note, updated_at)
  values (v_evento_id, p_room, p_menu_id, coalesce(p_senza_glutine, false), v_note, now())
  on conflict (evento_id, room) do update
    set menu_id = excluded.menu_id,
        senza_glutine = excluded.senza_glutine,
        note = excluded.note,
        updated_at = now();

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
      'paypal_link', v_evento.paypal_link, 'satispay_link', v_evento.satispay_link,
      'chiuso', v_evento.chiuso, 'attiva', (not v_evento.chiuso and now() < v_evento.scadenza),
      'menu', grigliata_menu_di(v_evento.id)
    ),
    'adesioni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'room', a.room, 'menu_id', a.menu_id,
        'senza_glutine', a.senza_glutine, 'note', a.note,
        'pagamento_dichiarato', a.pagamento_dichiarato, 'pagamento_confermato', a.pagamento_confermato,
        'confermato_da', a.confermato_da, 'confermato_at', a.confermato_at
      ) order by a.room)
      from grigliata_adesione a where a.evento_id = v_evento.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function grigliata_admin_aggiungi_adesione(p_evento_id bigint, p_room text, p_menu_id bigint)
returns jsonb language plpgsql as $$
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

  insert into grigliata_adesione (evento_id, room, menu_id, updated_at)
  values (p_evento_id, btrim(p_room), p_menu_id, now())
  on conflict (evento_id, room) do update
    set menu_id = excluded.menu_id, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function grigliata_menu_errore(jsonb) from public, anon, authenticated;
revoke all on function grigliata_menu_di(bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_crea(text, timestamptz, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function grigliata_admin_modifica(bigint, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function grigliata_iscrivi(text, bigint, boolean, text) from public, anon, authenticated;
revoke all on function grigliata_admin_aggiungi_adesione(bigint, text, bigint) from public, anon, authenticated;

grant execute on function grigliata_menu_errore(jsonb) to service_role;
grant execute on function grigliata_menu_di(bigint) to service_role;
grant execute on function grigliata_admin_crea(text, timestamptz, text, text, jsonb, text) to service_role;
grant execute on function grigliata_admin_modifica(bigint, text, timestamptz, jsonb) to service_role;
grant execute on function grigliata_iscrivi(text, bigint, boolean, text) to service_role;
grant execute on function grigliata_admin_aggiungi_adesione(bigint, text, bigint) to service_role;
