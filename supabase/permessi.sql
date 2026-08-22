-- Permessi delle funzioni. DA ESEGUIRE PER ULTIMO.
--
-- File consolidato dalla migrazione 005. E' l'ultimo passo di una
-- ricostruzione, e non e' facoltativo: senza, ogni funzione di questo schema
-- resta invocabile via /rest/v1/rpc/ da chiunque abbia la chiave pubblicabile
-- di Supabase — cioe' scavalcando in blocco il cookie di sessione, gli hash
-- scrypt, la distinzione FDO/sistemista e il rate limit, che vivono tutti
-- nelle funzioni serverless. Fra le funzioni cosi' esposte c'e' anche
-- sysadmin_purge, cioe' "svuota tutto".
--
-- Va per ultimo perche' agisce su TUTTE le funzioni gia' create: eseguirlo a
-- meta' lascerebbe scoperte quelle definite dopo.

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

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;
alter default privileges in schema public grant execute on functions to service_role;
