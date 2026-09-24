-- Correzione a 043: quel commit aveva creato una scheda admin "Sale" a
-- parte, con admin_spaces() esteso per leggere lo stato di ogni sala. Non
-- era quello che serviva — il pulsante per chiudere una sala vive invece
-- DENTRO la vista sala stessa (Rooms.tsx), visibile a FDO/sistemista, non
-- in una sezione separata del pannello. La scheda admin è stata tolta dal
-- lato client; qui si toglie il campo 'sale' che serviva solo a lei —
-- admin_spaces() torna alla sua forma originale. space_admin_set_chiuso()
-- e la colonna room_space.chiuso restano: sono loro il meccanismo vero, e
-- il nuovo pulsante inline li usa allo stesso modo.

create or replace function admin_spaces()
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'items', coalesce(jsonb_agg(x order by x->>'space', x->>'day'), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'id', b.id, 'space', s.slug, 'day', b.day,
      'start', b.start_min, 'end', b.end_min,
      'name', b.name, 'type', b.btype
    ) as x
    from space_booking b
    join room_space s on s.id = b.space_id
    where b.week_start = current_week_start('Europe/Rome')
  ) t;
$$;
