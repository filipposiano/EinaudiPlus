-- v1.7: il delegato può annullare una conferma di pagamento data per
-- errore — "torna indietro". Si rifiuta se anche un solo ticket di
-- quell'adesione è già stato usato (il cibo è già uscito sulla base di
-- quella conferma); altrimenti i ticket non ancora usati spariscono con
-- lei, perché erano nati da quella stessa conferma.
--
-- Nessuna firma esistente cambia: solo una funzione nuova. Consolidato in
-- supabase/grigliata.sql.

create or replace function grigliata_admin_annulla_conferma_pagamento(p_adesione_id bigint)
returns jsonb language plpgsql as $$
declare
  v_usati int;
  v_room text;
begin
  select count(*) into v_usati from grigliata_ticket where adesione_id = p_adesione_id and usato;
  if v_usati > 0 then
    return jsonb_build_object('ok', false, 'error',
      format('%s ticket già %s: non si può annullare la conferma', v_usati,
             case when v_usati = 1 then 'usato' else 'usati' end));
  end if;

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

revoke all on function grigliata_admin_annulla_conferma_pagamento(bigint) from public, anon, authenticated;
grant execute on function grigliata_admin_annulla_conferma_pagamento(bigint) to service_role;
