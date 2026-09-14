-- Permessi per le funzioni introdotte in migrations/033.
--
-- Ogni altra funzione applicativa del progetto ha il suo revoke/grant
-- esplicito (vedi bici.sql, account.sql, tema.sql...), anche se
-- permessi.sql imposta già un default (`alter default privileges in schema
-- public grant execute on functions to service_role`) che le avrebbe
-- comunque coperte automaticamente: la 033 non le aveva, per coerenza con
-- il resto del progetto le aggiunge qui.
--
-- laundry_snapshot, book_laundry, clear_laundry, book_as_direzione e
-- admin_force_book non compaiono: esistevano già prima della 033 (create or
-- replace non tocca i permessi di una funzione già esistente, a parità di
-- firma) e sono già bloccate dai loro revoke/grant originali.

revoke all on function laundry_preview_active(text) from public, anon, authenticated;
revoke all on function laundry_week_start_for_day(smallint, integer) from public, anon, authenticated;
revoke all on function week_snapshot_mixed(smallint) from public, anon, authenticated;

grant execute on function laundry_preview_active(text) to service_role;
grant execute on function laundry_week_start_for_day(smallint, integer) to service_role;
grant execute on function week_snapshot_mixed(smallint) to service_role;
