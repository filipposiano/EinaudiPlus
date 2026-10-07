-- v1.9: aggiungendo una camera a mano, il delegato può indicare anche
-- "senza glutine". Nuovo parametro facoltativo in fondo: la firma cambia,
-- quindi si toglie prima la vecchia (due versioni insieme = errore PGRST203).
--
-- Consolidato in supabase/grigliata.sql.

drop function if exists grigliata_admin_aggiungi_adesione(bigint, text, bigint, text);

create or replace function grigliata_admin_aggiungi_adesione(
  p_evento_id bigint, p_room text, p_menu_id bigint, p_dieta text, p_senza_glutine boolean default null
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

  insert into grigliata_adesione (evento_id, room, menu_id, dieta, senza_glutine, updated_at)
  values (p_evento_id, btrim(p_room), p_menu_id, v_dieta, coalesce(p_senza_glutine, false), now())
  on conflict (evento_id, room) do update
    set menu_id = excluded.menu_id, dieta = excluded.dieta,
        senza_glutine = coalesce(p_senza_glutine, grigliata_adesione.senza_glutine),
        updated_at = now();

  perform grigliata_allinea_ticket(p_evento_id);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function grigliata_admin_aggiungi_adesione(bigint, text, bigint, text, boolean) from public, anon, authenticated;
grant execute on function grigliata_admin_aggiungi_adesione(bigint, text, bigint, text, boolean) to service_role;
