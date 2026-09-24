-- v1.3.1: "vegetariano"/"vegano" tornano un'informazione A SÉ, indipendente
-- dal menu — si può scegliere il menu "Carne" (uno di quelli configurati dal
-- delegato) e dichiararsi comunque vegani, esattamente come si dichiara
-- "senza glutine" qualunque menu si sia scelto.
--
-- La migrazione 046 aveva ripiegato erroneamente le tre diciture storiche
-- (mangio tutto/vegetariano/vegano) dentro il nuovo concetto di "menu
-- configurabile", come se fossero LA stessa cosa. Non lo sono: il menu è
-- cosa mangia (carne/pesce/...), la dieta è un vincolo che vale a parte. Qui
-- si separano di nuovo, recuperando l'informazione da dove la 046 l'aveva
-- lasciata (il nome del menu a cui ciascuna adesione era finita agganciata).
--
-- Consolidato in supabase/grigliata.sql; qui la versione da applicare a un
-- database già in produzione (dopo la 046).

alter table grigliata_adesione add column if not exists dieta text not null default 'classico'
  check (dieta in ('classico', 'vegetariano', 'vegano'));

-- Recupera l'informazione da dove l'aveva lasciata la 046: i tre menu che
-- aveva auto-generato si chiamavano esattamente 'Mangio tutto'/'Vegetariano'
-- /'Vegano', e ogni adesione era stata agganciata a quello corrispondente.
update grigliata_adesione a
set dieta = case lower(btrim(m.nome))
  when 'vegetariano' then 'vegetariano'
  when 'vegano' then 'vegano'
  else 'classico'
end
from grigliata_menu m
where m.id = a.menu_id;

-- Ricompatta l'artefatto della 046: un evento che ha ESATTAMENTE i tre menu
-- auto-generati (nessuna personalizzazione del delegato nel frattempo) li
-- riporta a un solo menu "Mangio tutto" — altrimenti ogni grigliata già
-- esistente si ritroverebbe con tre menu fantasma che non hanno più alcun
-- significato (la dieta, appena recuperata sopra, ormai vive altrove). Il
-- confronto è sul nome esatto apposta: un evento con un vero menu "Halal"
-- aggiunto dal delegato non ha questa terna esatta e resta intatto.
do $$
declare
  v_evento_id bigint;
  v_base_id bigint;
begin
  for v_evento_id in
    select m.evento_id
    from grigliata_menu m
    group by m.evento_id
    having count(*) = 3
       and count(*) filter (where lower(btrim(m.nome)) = 'mangio tutto') = 1
       and count(*) filter (where lower(btrim(m.nome)) = 'vegetariano') = 1
       and count(*) filter (where lower(btrim(m.nome)) = 'vegano') = 1
  loop
    select id into v_base_id from grigliata_menu
      where evento_id = v_evento_id and lower(btrim(nome)) = 'mangio tutto';

    update grigliata_adesione set menu_id = v_base_id
      where evento_id = v_evento_id and menu_id <> v_base_id;

    delete from grigliata_menu where evento_id = v_evento_id and id <> v_base_id;
  end loop;
end $$;

-- Le due funzioni che cambiano firma vanno tolte prima di ricrearle.
drop function if exists grigliata_iscrivi(text, bigint, boolean, text);
drop function if exists grigliata_admin_aggiungi_adesione(bigint, text, bigint);

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
      'dieta', v_adesione.dieta,
      'senza_glutine', v_adesione.senza_glutine,
      'note', v_adesione.note,
      'pagamento_dichiarato', v_adesione.pagamento_dichiarato,
      'pagamento_confermato', v_adesione.pagamento_confermato
    ) end
  );
end;
$$;

-- Aderisce, col menu — non c'è più modo di "declinare" (v1.1). Upsert:
-- aderire due volte aggiorna la stessa riga, non ne crea una seconda. I
-- flag di pagamento NON si toccano qui apposta.
--
-- v1.3.1: "dieta" torna un campo a sé, indipendente dal menu scelto — un
-- valore mancante o non riconosciuto ricade su 'classico', non è un errore
-- bloccante (stessa scelta di "senza glutine").
create or replace function grigliata_iscrivi(
  p_room text, p_menu_id bigint, p_dieta text, p_senza_glutine boolean, p_note text
) returns jsonb language plpgsql as $$
declare
  v_evento_id bigint;
  v_dieta text;
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

-- Aggiunge (o corregge) a mano l'adesione di una camera — per chi non usa
-- l'app, o per registrare chi ha dato la sua parola di persona. Upsert come
-- grigliata_iscrivi. Tocca menu e dieta; "senza glutine" e la nota di una
-- camera che aveva già risposto da sé restano quelli che ha scritto lei.
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

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function grigliata_iscrivi(text, bigint, text, boolean, text) from public, anon, authenticated;
revoke all on function grigliata_admin_aggiungi_adesione(bigint, text, bigint, text) from public, anon, authenticated;

grant execute on function grigliata_iscrivi(text, bigint, text, boolean, text) to service_role;
grant execute on function grigliata_admin_aggiungi_adesione(bigint, text, bigint, text) to service_role;
