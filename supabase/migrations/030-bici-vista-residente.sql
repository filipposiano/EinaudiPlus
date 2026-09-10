-- Il residente deve poter vedere CHI ha dichiarato la sua bici, non solo SE.
--
-- bike_get (dalla 024) tornava solo has_bike: un booleano. Con le
-- assegnazioni dalla reception (migrazione 029) non basta piu' — una camera
-- che si ritrova "ha una bici" senza averla mai toccata deve poter leggere
-- che e' stata la reception a segnarla, cosi' come puo' correggerla se e'
-- sbagliata (bike_set, gia' esistente, la toglie qualunque sia la sua
-- origine: e' sempre e comunque la SUA camera).

create or replace function bike_get(p_room text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ok', true,
    'has_bike', exists(select 1 from bike where room = p_room),
    'creato_da', (select creato_da from bike where room = p_room)
  );
$$;

-- Nessuna modifica ai permessi: stessa firma di prima (p_room text), gia'
-- concessa a service_role dalla 024.
