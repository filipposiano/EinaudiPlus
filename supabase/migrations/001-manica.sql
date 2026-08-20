-- La seconda lavanderia si chiama Manica, e ha anche un'asciugatrice.
--
-- Idempotente: si puo' rieseguire senza danni.

-- ─────────────────────────────────────────────────────────────────────────────
-- Nome
--
-- Lo slug cambia insieme al nome: non e' referenziato da codice applicativo,
-- solo dai seed e da qualche commento. Le prenotazioni puntano a laundry_id,
-- quindi rinominare non tocca nulla di esistente.
-- ─────────────────────────────────────────────────────────────────────────────

update laundry
set slug = 'manica', name = 'Lavanderia Manica'
where slug = 'sezione';

-- ─────────────────────────────────────────────────────────────────────────────
-- L'asciugatrice
--
-- Le prenotazioni delle asciugatrici non si salvano: restano derivate lato
-- client (lavatrice X al turno N -> asciugatrice X al turno N+1). Perche' D-A
-- compaia e sia usabile bastano quindi due colonne: esiste, e non e' guasta.
-- ─────────────────────────────────────────────────────────────────────────────

update machine m
set bookable = true, is_oos = false, updated_at = now()
from laundry l
where l.id = m.laundry_id and l.slug = 'manica' and m.code = 'D-A';

-- Verifica: Manica deve avere W-A e D-A utilizzabili, il resto no.
--   select l.slug, m.code, m.bookable, m.is_oos
--   from machine m join laundry l on l.id = m.laundry_id
--   where l.slug = 'manica' order by m.sort_order;
