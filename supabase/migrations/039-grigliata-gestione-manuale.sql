-- Estende il modulo Grigliata (migrations/038): il delegato può correggere
-- il titolo insieme alla scadenza (non solo la scadenza da sola), e può
-- aggiungere o togliere a mano l'adesione di una camera — per chi non usa
-- l'app, o per registrare/disfare una risposta data di persona.
-- Consolidato in supabase/grigliata.sql; qui la versione da applicare a un
-- database già in produzione (dopo la 038).
--
-- grigliata_admin_modifica_scadenza(bigint, timestamptz) diventa
-- grigliata_admin_modifica(bigint, text, timestamptz): un nome nuovo perché
-- la firma cambia (guadagna p_titolo), non un CREATE OR REPLACE, che
-- richiede la stessa identica lista di parametri. La vecchia funzione va
-- tolta esplicitamente, altrimenti resta raggiungibile senza motivo.

drop function if exists grigliata_admin_modifica_scadenza(bigint, timestamptz);

create or replace function grigliata_admin_modifica(p_evento_id bigint, p_titolo text, p_scadenza timestamptz)
returns jsonb language plpgsql as $$
begin
  if p_scadenza is null or p_scadenza <= now() then
    return jsonb_build_object('ok', false, 'error', 'la scadenza deve essere nel futuro');
  end if;

  update grigliata_evento
    set titolo = coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
        scadenza = p_scadenza
    where id = p_evento_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;

  return jsonb_build_object('ok', true, 'scadenza', p_scadenza);
end;
$$;

create or replace function grigliata_admin_aggiungi_adesione(p_evento_id bigint, p_room text, p_menu text)
returns jsonb language plpgsql as $$
begin
  if not exists (select 1 from grigliata_evento where id = p_evento_id) then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;
  if p_room is null or btrim(p_room) = '' then
    return jsonb_build_object('ok', false, 'error', 'camera mancante');
  end if;
  if p_menu is null or p_menu not in ('classico', 'vegano') then
    return jsonb_build_object('ok', false, 'error', 'scegli un menu');
  end if;

  insert into grigliata_adesione (evento_id, room, partecipa, menu, updated_at)
  values (p_evento_id, btrim(p_room), true, p_menu, now())
  on conflict (evento_id, room) do update
    set partecipa = true, menu = excluded.menu, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function grigliata_admin_rimuovi_adesione(p_adesione_id bigint)
returns jsonb language plpgsql as $$
begin
  delete from grigliata_adesione where id = p_adesione_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'adesione non trovata');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function grigliata_admin_modifica(bigint, text, timestamptz) from public, anon, authenticated;
revoke all on function grigliata_admin_aggiungi_adesione(bigint, text, text) from public, anon, authenticated;
revoke all on function grigliata_admin_rimuovi_adesione(bigint) from public, anon, authenticated;

grant execute on function grigliata_admin_modifica(bigint, text, timestamptz) to service_role;
grant execute on function grigliata_admin_aggiungi_adesione(bigint, text, text) to service_role;
grant execute on function grigliata_admin_rimuovi_adesione(bigint) to service_role;
