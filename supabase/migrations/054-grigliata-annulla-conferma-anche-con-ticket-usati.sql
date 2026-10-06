-- v1.7.1: grigliata_admin_annulla_conferma_pagamento() non si rifiuta più
-- se un ticket di quell'adesione è già stato usato — il delegato deve
-- poter correggere una conferma data per errore a prescindere da cos'è già
-- successo al banco. I ticket NON ancora usati spariscono comunque con la
-- conferma; quelli GIÀ usati restano, come traccia di quel che è stato
-- davvero servito.
--
-- Nessuna firma cambia: solo il corpo. Consolidato in supabase/grigliata.sql.

create or replace function grigliata_admin_annulla_conferma_pagamento(p_adesione_id bigint)
returns jsonb language plpgsql as $$
declare
  v_room text;
begin
  delete from grigliata_ticket where adesione_id = p_adesione_id and not usato;

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
