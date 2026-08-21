-- Due cose che questa revisione di sicurezza ha trovato.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Il doppione di book_laundry
--
-- La migrazione 003 ha aggiunto `p_actor_room` con `create or replace`. Ma
-- aggiungere un parametro cambia la firma, quindi Postgres non ha sostituito
-- niente: ha creato una funzione NUOVA accanto alla vecchia. Da quel momento
-- ne esistevano due, e una chiamata che non nomina `p_actor_room` diventava
-- ambigua — PostgREST rispondeva PGRST203 e la prenotazione falliva:
--
--   Could not choose the best candidate function between:
--     public.book_laundry(p_room, p_day, p_slot, p_machine, p_as_admin)
--     public.book_laundry(p_room, p_day, p_slot, p_machine, p_as_admin, p_actor_room)
--
-- Nel commento della 003 avevo scritto che i client vecchi avrebbero
-- continuato a funzionare "come prima". Non era vero: chiunque girasse ancora
-- con il bundle precedente riceveva "errore del server" al momento di
-- prenotare. Si toglie la versione a cinque parametri e ne resta una sola, con
-- il parametro facoltativo — che e' il comportamento che si voleva.

drop function if exists book_laundry(text, integer, integer, text, boolean);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Le funzioni erano eseguibili dal ruolo `anon`
--
-- Postgres concede EXECUTE a PUBLIC su ogni funzione appena creata, e in un
-- progetto Supabase PUBLIC comprende `anon` e `authenticated`: i ruoli che
-- PostgREST assume quando la richiesta arriva con la chiave pubblicabile.
--
-- Il risultato e' che TUTTE le nostre funzioni erano invocabili direttamente
-- via /rest/v1/rpc/ da chi avesse quella chiave, scavalcando in blocco
-- l'autenticazione del pannello: il cookie di sessione, gli hash scrypt, la
-- distinzione FDO/sistemista, il rate limit. Tutti controlli che vivono nella
-- funzione serverless su Vercel, mentre il database esponeva le stesse
-- operazioni da un'altra porta. Fra queste c'era `sysadmin_purge`, cioe'
-- "svuota tutto".
--
-- Non era sfruttabile da chiunque — serve la chiave pubblicabile, che non
-- compare nel bundle di questa app (verificato) ne' altrove. Ma quella chiave
-- in Supabase e' pubblica per progetto: e' pensata per stare dentro i client,
-- viene condivisa e incollata senza pensarci. Far dipendere l'intero modello
-- di autorizzazione dal fatto che non venga mai fuori e' un equilibrio che
-- prima o poi cade, e cade in silenzio.
--
-- Qui l'accesso si restringe a `service_role`, che e' il ruolo della Secret
-- key usata da /api. Le funzioni continuano a funzionare esattamente come
-- prima per l'app; smettono di esistere per chiunque altro.
--
-- Non si tocca lo schema `extensions` ne' le funzioni installate dalle
-- estensioni: quelle servono a Supabase per lavorare.

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure::text as firma
    from pg_proc p
    left join pg_depend d on d.objid = p.oid and d.deptype = 'e'   -- 'e' = appartiene a un'estensione
    where p.pronamespace = 'public'::regnamespace
      and d.objid is null
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
    execute format('grant execute on function %s to service_role', f.firma);
  end loop;
end $$;

-- E per quelle che verranno create in futuro, cosi' il buco non si riapre alla
-- prossima migrazione distratta.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;
alter default privileges in schema public grant execute on functions to service_role;
