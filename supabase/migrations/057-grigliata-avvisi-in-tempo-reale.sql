-- v1.9: avvisi in tempo reale (Supabase Realtime, broadcast dal database).
--
-- Quando cambia qualcosa della grigliata, il database manda un messaggio
-- VUOTO ("è cambiato qualcosa, ricarica") su un canale pubblico; chi è in
-- ascolto rilegge i dati dalla solita API. Il messaggio non contiene nessun
-- dato: la sicurezza resta tutta dov'era (API + RLS), il canale dice solo
-- QUANDO ricaricare.
--
-- Pensato per il giorno della grigliata, con ~90 persone connesse insieme:
-- ogni avviso va SOLO a chi riguarda, per non far ricaricare tutti a ogni
-- ticket usato.
--   grigliata:admin           ogni cambiamento (il pannello del delegato)
--   grigliata:camera:<room>   adesione e ticket di QUELLA camera
--   grigliata:tutti           l'evento, i menu, le voci-ticket (raro)
-- Il contatore dei ticket (grigliata_evento.ticket_contatore), che cambia a
-- ogni ticket usato, NON avvisa "tutti": interessa solo l'admin, che lo
-- riceve già dall'avviso del ticket stesso.
--
-- Trigger "per istruzione" con tabelle di transizione, non "per riga": un
-- riallineamento che crea 87 ticket in un colpo manda un avviso per camera
-- e UNO all'admin, non 87 all'admin.
--
-- Se Realtime non è disponibile, l'avviso fallisce in silenzio: non deve
-- mai far fallire l'azione vera (usare un ticket, confermare un pagamento).
-- L'app ricontrolla comunque da sola ogni tanto.
--
-- Consolidato in supabase/grigliata.sql.

create or replace function grigliata_avvisa(p_topic text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send('{}'::jsonb, 'cambio', p_topic, false);
exception when others then
  null;
end;
$$;

create or replace function grigliata_trg_avvisa_adesione()
returns trigger language plpgsql as $$
declare
  v_room text;
begin
  perform grigliata_avvisa('grigliata:admin');
  if TG_OP = 'DELETE' then
    for v_room in select distinct room from vecchie loop
      perform grigliata_avvisa('grigliata:camera:' || v_room);
    end loop;
  else
    for v_room in select distinct room from nuove loop
      perform grigliata_avvisa('grigliata:camera:' || v_room);
    end loop;
  end if;
  return null;
end;
$$;

create or replace function grigliata_trg_avvisa_ticket()
returns trigger language plpgsql as $$
declare
  v_room text;
begin
  perform grigliata_avvisa('grigliata:admin');
  -- Un ticket cancellato insieme alla sua adesione non trova più la
  -- camera: la avvisa già il trigger dell'adesione.
  if TG_OP = 'DELETE' then
    for v_room in select distinct a.room from vecchie t join grigliata_adesione a on a.id = t.adesione_id loop
      perform grigliata_avvisa('grigliata:camera:' || v_room);
    end loop;
  else
    for v_room in select distinct a.room from nuove t join grigliata_adesione a on a.id = t.adesione_id loop
      perform grigliata_avvisa('grigliata:camera:' || v_room);
    end loop;
  end if;
  return null;
end;
$$;

create or replace function grigliata_trg_avvisa_evento()
returns trigger language plpgsql as $$
begin
  -- Se è cambiato SOLO il contatore dei ticket, nessun avviso: vedi in testa.
  if TG_OP = 'UPDATE' and not exists (
    select 1 from nuove n join vecchie v on v.id = n.id
    where (n.titolo, n.scadenza, n.giorno_evento, n.paypal_link, n.satispay_link,
           n.pagamenti_attivi, n.quota, n.chiuso)
      is distinct from
          (v.titolo, v.scadenza, v.giorno_evento, v.paypal_link, v.satispay_link,
           v.pagamenti_attivi, v.quota, v.chiuso)
  ) then
    return null;
  end if;
  perform grigliata_avvisa('grigliata:admin');
  perform grigliata_avvisa('grigliata:tutti');
  return null;
end;
$$;

create or replace function grigliata_trg_avvisa_menu()
returns trigger language plpgsql as $$
begin
  perform grigliata_avvisa('grigliata:admin');
  perform grigliata_avvisa('grigliata:tutti');
  return null;
end;
$$;

-- Un trigger con tabelle di transizione può avere un solo evento: tre per
-- tabella dove servono le righe toccate.
drop trigger if exists grigliata_avvisa_adesione_ins on grigliata_adesione;
drop trigger if exists grigliata_avvisa_adesione_upd on grigliata_adesione;
drop trigger if exists grigliata_avvisa_adesione_del on grigliata_adesione;
create trigger grigliata_avvisa_adesione_ins after insert on grigliata_adesione
  referencing new table as nuove for each statement execute function grigliata_trg_avvisa_adesione();
create trigger grigliata_avvisa_adesione_upd after update on grigliata_adesione
  referencing new table as nuove for each statement execute function grigliata_trg_avvisa_adesione();
create trigger grigliata_avvisa_adesione_del after delete on grigliata_adesione
  referencing old table as vecchie for each statement execute function grigliata_trg_avvisa_adesione();

drop trigger if exists grigliata_avvisa_ticket_ins on grigliata_ticket;
drop trigger if exists grigliata_avvisa_ticket_upd on grigliata_ticket;
drop trigger if exists grigliata_avvisa_ticket_del on grigliata_ticket;
create trigger grigliata_avvisa_ticket_ins after insert on grigliata_ticket
  referencing new table as nuove for each statement execute function grigliata_trg_avvisa_ticket();
create trigger grigliata_avvisa_ticket_upd after update on grigliata_ticket
  referencing new table as nuove for each statement execute function grigliata_trg_avvisa_ticket();
create trigger grigliata_avvisa_ticket_del after delete on grigliata_ticket
  referencing old table as vecchie for each statement execute function grigliata_trg_avvisa_ticket();

drop trigger if exists grigliata_avvisa_evento_ins on grigliata_evento;
drop trigger if exists grigliata_avvisa_evento_upd on grigliata_evento;
drop trigger if exists grigliata_avvisa_evento_del on grigliata_evento;
create trigger grigliata_avvisa_evento_ins after insert on grigliata_evento
  for each statement execute function grigliata_trg_avvisa_menu();
create trigger grigliata_avvisa_evento_upd after update on grigliata_evento
  referencing new table as nuove old table as vecchie for each statement execute function grigliata_trg_avvisa_evento();
create trigger grigliata_avvisa_evento_del after delete on grigliata_evento
  for each statement execute function grigliata_trg_avvisa_menu();

drop trigger if exists grigliata_avvisa_menu on grigliata_menu;
create trigger grigliata_avvisa_menu after insert or update or delete on grigliata_menu
  for each statement execute function grigliata_trg_avvisa_menu();

drop trigger if exists grigliata_avvisa_menu_ticket on grigliata_menu_ticket;
create trigger grigliata_avvisa_menu_ticket after insert or update or delete on grigliata_menu_ticket
  for each statement execute function grigliata_trg_avvisa_menu();

-- grigliata_avvisa è security definer (deve poter chiamare realtime.send):
-- nessuno da fuori deve poterla usare per spedire messaggi a piacere.
revoke all on function grigliata_avvisa(text) from public, anon, authenticated;
revoke all on function grigliata_trg_avvisa_adesione() from public, anon, authenticated;
revoke all on function grigliata_trg_avvisa_ticket() from public, anon, authenticated;
revoke all on function grigliata_trg_avvisa_evento() from public, anon, authenticated;
revoke all on function grigliata_trg_avvisa_menu() from public, anon, authenticated;
