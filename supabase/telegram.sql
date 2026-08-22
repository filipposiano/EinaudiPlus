-- ─────────────────────────────────────────────────────────────────────────────
-- FILE CONSOLIDATO: contiene lo stato ATTUALE, non quello iniziale.
--
-- Le migrazioni in migrations/ sono gia' incorporate qui. Non vanno riapplicate
-- sopra a questo file, e questo file non va rieseguito su un database gia' in
-- produzione: le due cose insieme creerebbero doppioni di funzione (due
-- overload della stessa RPC = errore PGRST203, che PostgREST non sa risolvere).
--
-- Ordine di ricostruzione e ruolo di ciascun file: vedi README.md.
-- ─────────────────────────────────────────────────────────────────────────────
-- Promemoria via Telegram, opzionali.
--
-- Non è un port: il Telegram che c'era in laundry-Code.gs mandava tutto a un
-- singolo canale fisso, uguale per tutti. Qui ogni residente collega la propria
-- chat alla propria camera.
--
-- Perché serve un codice e non basta il numero di camera: chiunque potrebbe
-- scrivere al bot "sono la 112" e ricevere i promemoria di un altro. Il codice
-- si genera dentro l'app, dura poco, e si usa una volta sola.

-- Genera (o rigenera) il codice di collegamento per una camera.
create or replace function telegram_create_code(p_room text)
returns jsonb language plpgsql as $$
declare
  v_lid  smallint;
  v_code text;
begin
  if p_room is null or p_room !~ '^[0-9]{1,4}(-?[abAB])?$' then
    return jsonb_build_object('ok', false, 'error', 'camera non valida');
  end if;

  v_lid := laundry_for_room(p_room);
  if v_lid is null then
    return jsonb_build_object('ok', false, 'error', 'camera non valida');
  end if;

  -- 8 caratteri senza vocali: niente parole leggibili per caso, e nessuna
  -- ambiguità fra 0/O e 1/I quando qualcuno lo ricopia a mano.
  v_code := upper(translate(encode(gen_random_bytes(8), 'base64'), 'AEIOUaeiou+/=', 'BCDFGHJKMN23'));
  v_code := left(v_code, 8);

  -- Un codice per volta per camera: rigenerandolo il precedente non vale più.
  delete from telegram_sub where room = p_room and verified_at is null;

  insert into telegram_sub (chat_id, room, laundry_id, link_code)
  values ('pending:' || v_code, p_room, v_lid, v_code);

  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

-- Chiamata dal webhook quando l'utente manda /start <codice>.
create or replace function telegram_link(p_code text, p_chat_id text)
returns jsonb language plpgsql as $$
declare
  v_row telegram_sub%rowtype;
begin
  select * into v_row from telegram_sub
  where link_code = upper(btrim(p_code)) and verified_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'codice non valido o già usato');
  end if;

  -- Un solo collegamento per chat: se l'utente rifà /start con un'altra camera,
  -- il vecchio sparisce invece di far arrivare i promemoria di due stanze.
  delete from telegram_sub where chat_id = p_chat_id and id <> v_row.id;

  update telegram_sub
  set chat_id = p_chat_id, verified_at = now(), link_code = null
  where id = v_row.id;

  return jsonb_build_object('ok', true, 'room', v_row.room);
end;
$$;

create or replace function telegram_unlink(p_chat_id text)
returns jsonb language plpgsql as $$
declare v_n int;
begin
  delete from telegram_sub where chat_id = p_chat_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'removed', v_n);
end;
$$;

-- Le righe 'pending:' non confermate scadono: un codice generato e mai usato
-- non deve restare valido per sempre. Chiamata dalla potatura settimanale.
create or replace function telegram_prune_pending(p_hours int default 24)
returns int language plpgsql as $$
declare v_n int;
begin
  delete from telegram_sub
  where verified_at is null and created_at < now() - make_interval(hours => p_hours);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
