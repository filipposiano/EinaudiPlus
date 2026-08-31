-- Bug: da un dispositivo con sessione amministrativa (FDO/staff/sistemista),
-- l'identita' nell'app principale e' DIREZIONE (vedi App.tsx — "Chi
-- amministra non ha una camera propria"), e collegare Telegram da li' dava
-- sempre "camera non valida". E' proprio il caso della portineria, che apre
-- l'app dal PC: da qui il bug segnalato come "da pc non mi fa collegare
-- Telegram".
--
-- La causa: telegram_create_code() accetta solo il formato di una camera vera
-- (cifre + lettera opzionale), e DIREZIONE non lo e'. upsert_push_sub() invece
-- una scappatoia ce l'ha gia' (COALESCE su laundry_for_room, che per DIREZIONE
-- torna null) — ma prima di arrivarci il livello sopra, /api/laundry, la
-- respingeva comunque con lo stesso identico controllo. Le notifiche push
-- avevano perciò lo stesso identico bug, solo mai segnalato.
--
-- Non e' un problema di sicurezza allargare il permesso: le prenotazioni della
-- DIREZIONE sono già pubbliche (la griglia della settimana non ha login), e
-- iscriversi ai suoi promemoria non da' nessun potere in più. Il confine vero
-- resta dove serve — creare o cancellare un turno della DIREZIONE passa
-- comunque solo dall'endpoint amministrativo, autenticato dal cookie.
create or replace function telegram_create_code(p_room text)
returns jsonb language plpgsql as $$
declare
  v_lid  smallint;
  v_code text;
begin
  if p_room is null or (p_room <> 'DIREZIONE' and p_room !~ '^[0-9]{1,4}(-?[abAB])?$') then
    return jsonb_build_object('ok', false, 'error', 'camera non valida');
  end if;

  -- Come in upsert_push_sub: DIREZIONE non ha un edificio, i suoi promemoria
  -- si appoggiano al Valentino.
  v_lid := coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));

  v_code := upper(translate(encode(gen_random_bytes(8), 'base64'), 'AEIOUaeiou+/=', 'BCDFGHJKMN23'));
  v_code := left(v_code, 8);

  delete from telegram_sub where room = p_room and verified_at is null;

  insert into telegram_sub (chat_id, room, laundry_id, link_code)
  values ('pending:' || v_code, p_room, v_lid, v_code);

  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;
