-- v1.7.2: l'overview admin restituisce anche il contatore dei ticket
-- dell'evento (grigliata_evento.ticket_contatore, aggiunto dalla 055): il
-- pannello del delegato mostra a che numero si è arrivati. Richiede la 055.
--
-- Nessuna firma cambia. Consolidato in supabase/grigliata.sql.

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
      'ticket_contatore', v_evento.ticket_contatore,
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
