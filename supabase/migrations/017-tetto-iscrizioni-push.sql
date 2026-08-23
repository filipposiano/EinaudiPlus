-- 017 — Un tetto alle iscrizioni push per camera.
--
-- IL PROBLEMA
--
-- `subscribe` (api/laundry.js) non ha modo di verificare che chi dice "sono la
-- 112" sia davvero la 112: i residenti non hanno un account, il numero di
-- camera e' l'unica identita' e chiunque puo' dichiararlo. Finora, di
-- conseguenza, si potevano attaccare a una camera quante iscrizioni si
-- volevano.
--
-- Cosa NON e' questo cambiamento: non impedisce a un estraneo di ricevere i
-- promemoria della 112. Non e' possibile impedirlo senza un'identita' vera per
-- i residenti, e comunque non ci sarebbe molto da proteggere: la griglia della
-- settimana, numeri di camera compresi, la legge gia' chiunque apra l'app.
--
-- Cosa e': un limite alla quantita'. Senza, un solo dispositivo poteva
-- registrare centinaia di endpoint sulla stessa camera, e ogni promemoria di
-- quella camera sarebbe diventato centinaia di invii dentro l'unico
-- Promise.all di /api/cron — che ha un tetto di tempo di esecuzione e lo
-- condivide con i promemoria di TUTTI gli altri. Il costo per chi attacca era
-- vicino a zero, il danno era il silenzio dell'intero tick.
--
-- SEI, e non uno: una camera ha fino a due posti letto, ciascuno con telefono e
-- magari tablet, e ogni reinstallazione della PWA crea un endpoint nuovo invece
-- di riusare il vecchio. Sotto il sei si rischia di bloccare un residente vero,
-- che e' il danno peggiore fra i due.
--
-- LA POTATURA prima del conteggio serve proprio ai reinstalli: refreshSubscription()
-- aggiorna last_seen a ogni apertura dell'app, quindi un'iscrizione ferma da tre
-- mesi e' di un dispositivo che non c'e' piu'. Senza, il tetto si riempirebbe da
-- solo col passare degli anni e il residente resterebbe fuori senza aver fatto
-- nulla di strano.
--
-- SI RIFIUTA, non si sfratta il piu' vecchio: sfrattare vuol dire che le
-- notifiche di qualcun altro smettono di arrivare in silenzio, e nessuno se ne
-- accorge finche' non salta un turno. Il rifiuto invece torna al client, che lo
-- mostra (push.ts disfa l'iscrizione del browser, cosi' lo stato non dice
-- "attive" mentre il server non ha nulla).

create or replace function upsert_push_sub(
  p_room text, p_endpoint text, p_p256dh text, p_auth text
) returns jsonb language plpgsql as $$
declare
  v_id   smallint;
  v_old  text;
  v_n    int;
  c_max  constant int := 6;
begin
  if p_endpoint is null or p_endpoint = '' then
    return jsonb_build_object('ok', false, 'error', 'subscription mancante');
  end if;

  v_id := coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));

  -- Dispositivi spariti: l'app non si apre da tre mesi su quell'endpoint.
  delete from push_sub
  where laundry_id = v_id
    and room = p_room
    and endpoint <> p_endpoint
    and last_seen < now() - interval '90 days';

  select room into v_old from push_sub where endpoint = p_endpoint;

  -- Il tetto vale per le iscrizioni NUOVE su questa camera. Un endpoint che
  -- gia' le appartiene si limita a rinnovarsi (e' cio' che fa
  -- refreshSubscription a ogni avvio, non deve mai fallire); un endpoint che
  -- arriva da un'altra camera e' un trasloco, quindi conta come nuovo.
  if v_old is distinct from p_room then
    select count(*) into v_n from push_sub where laundry_id = v_id and room = p_room;
    if v_n >= c_max then
      return jsonb_build_object(
        'ok', false,
        'error', 'troppi dispositivi collegati a questa camera: disattiva le notifiche su uno di quelli vecchi, oppure chiedi in portineria'
      );
    end if;
  end if;

  insert into push_sub (endpoint, p256dh, auth, room, laundry_id)
  values (p_endpoint, p_p256dh, p_auth, p_room, v_id)
  on conflict (endpoint) do update
    set room = excluded.room,
        laundry_id = excluded.laundry_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        last_seen = now(),
        fail_count = 0;

  return jsonb_build_object('ok', true);
end;
$$;

-- La firma non cambia, quindi `create or replace` conserva i permessi gia'
-- assegnati da 005. Si riscrivono lo stesso: costa nulla ed e' la garanzia che
-- la funzione non resti invocabile con la chiave pubblicabile se un domani
-- qualcuno la ricrea a mano.
revoke all on function upsert_push_sub(text, text, text, text) from public, anon, authenticated;
grant execute on function upsert_push_sub(text, text, text, text) to service_role;

-- ── Verifica ────────────────────────────────────────────────
--
-- Quante iscrizioni ha oggi ciascuna camera: se qualcuna e' gia' sopra il sei,
-- il tetto non la tocca (le righe esistenti restano), ma quel dispositivo non
-- potra' aggiungerne altri finche' non scendono.
--
--   select l.slug, s.room, count(*) as dispositivi,
--          max(s.last_seen) as ultimo_avvio
--   from push_sub s join laundry l on l.id = s.laundry_id
--   group by 1, 2
--   having count(*) > 3
--   order by 3 desc;
