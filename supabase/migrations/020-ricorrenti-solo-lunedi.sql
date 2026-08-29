-- Le regole ricorrenti non si applicano piu' a metà settimana, e il job
-- notturno non le ri-controlla piu' ogni notte.
--
-- Prima: creare una regola la materializzava subito nella settimana corrente
-- (api/admin/data.js chiamava apply_recurring(0) appena dopo l'insert), e il
-- cron 'ricorrenti' la ri-eseguiva ogni notte alle 02:00 UTC per
-- auto-ripararsi se una notte saltava.
--
-- L'auto-riparazione aveva un effetto collaterale non voluto: se un
-- amministratore cancellava a mano un'occorrenza creata da una regola (per
-- liberare quel turno per quella settimana), la notte dopo il job la
-- ricreava da capo — ON CONFLICT DO NOTHING non distingue "mai creata" da
-- "creata e poi tolta". Una cancellazione doveva restare cancellata.
--
-- Ora: una regola creata adesso vale dal lunedì successivo (il lato
-- applicativo non chiama piu' apply_recurring alla creazione), e il job gira
-- una sola volta a settimana — il lunedì alle 02:00 UTC, quando "settimana
-- corrente" e' gia' quella nuova. Il rovescio della medaglia: se questa
-- esecuzione salta, quella settimana le regole non si materializzano; resta
-- il pulsante "Applica ora" nel pannello per rimediare a mano.
--
-- cron.alter_job invece di ri-schedulare da capo: cosi' non serve reinserire
-- URL e segreto, che non stanno in questo file (vedi supabase/cron.sql).
select cron.alter_job(
  job_id   := (select jobid from cron.job where jobname = 'ricorrenti'),
  schedule := '0 2 * * 1'
);
