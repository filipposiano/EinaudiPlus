-- Corregge un bug reale, non solo cosmetico: linen_change_admin_get() non
-- ha mai restituito il campo 'ok' che ogni altra RPC di questo progetto
-- restituisce. api/admin/data.js inoltra la risposta della RPC così com'è
-- (vedi json(res, 200, result) alla fine dell'handler); il client
-- (features/admin-shared/adminApi.ts, call()) controlla `data.ok` e, se è
-- falso — undefined qui, quindi SEMPRE falso — solleva un errore col
-- messaggio "errore" (il fallback quando `data.error` manca anch'esso).
--
-- Risultato pratico: ogni apertura della scheda "Cambio biancheria" (a) fa
-- comparire una scatola con scritto "errore" in cima e (b) non completa mai
-- `setSalvata(r)` in CambioBiancheriaTab.tsx, perché quella riga vive dentro
-- un `.then()` che non viene mai raggiunto — la richiesta cade sempre nel
-- `.catch()`. La card "Configurazione attuale" quindi non compariva MAI, e
-- il form ripartiva sempre dai valori di default (prossimo martedì,
-- "grande") invece che da quanto salvato davvero: la vera causa
-- dell'ambiguità fra "calendario attuale" e "anteprima" segnalata insieme
-- a questo bug — non ce n'era uno vero da vedere.
--
-- Consolidato in supabase/cambio-biancheria.sql; qui la versione da
-- applicare a un database già in produzione (dopo la 036).

create or replace function linen_change_admin_get()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ok', true,
    'ancora_data', (select anchor_date from linen_change_anchor where id = true),
    'ancora_tipo', (select anchor_type from linen_change_anchor where id = true),
    'salta', coalesce((
      select jsonb_agg(skip_date order by skip_date)
      from linen_change_skip
      where skip_date >= current_date - interval '7 days'
    ), '[]'::jsonb)
  );
$$;
