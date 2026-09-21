-- Sposta l'inizio della finestra di anteprima del lunedì da sabato alle
-- 20:00 a sabato alle 16:00 — stessa firma, solo il corpo cambia, quindi un
-- CREATE OR REPLACE basta (non serve un DROP come per una firma diversa).
-- Consolidato in supabase/functions.sql; qui la versione da applicare a un
-- database già in produzione (dopo la 034).
--
-- Il lato client (computaAnteprimaLunedi() in modello.ts) e il test di
-- riferimento (tests/unit/anteprima-lunedi.test.mjs) vanno aggiornati
-- insieme a questa — le tre copie della stessa finestra, vedi il commento
-- in cima a laundry_preview_active().

create or replace function laundry_preview_active(p_tz text default 'Europe/Rome')
returns boolean language sql stable as $$
  select case extract(isodow from now() at time zone p_tz)::int
    when 6 then (now() at time zone p_tz)::time >= time '16:00'  -- sabato pomeriggio
    when 7 then true                                              -- domenica, tutta
    when 1 then (now() at time zone p_tz)::time <  time '07:00'   -- lunedì presto
    else false
  end;
$$;
