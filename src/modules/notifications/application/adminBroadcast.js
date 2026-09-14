// Use-case: notifica manuale ai dispositivi iscritti — a tutti, o a una sola
// camera. Usata per comunicazioni occasionali del sistemista, non per i
// promemoria automatici (quelli restano affari di sendDueReminders/cron).

import { ValidationError, RateLimitedError } from "../../../shared/errors/AppError.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";

// `checkRateLimit` arriva come dipendenza (non importato direttamente) per
// lo stesso motivo di `accountRepository`/`hasher` in Identity: rende questo
// use-case testabile con un limitatore finto, senza toccare Postgres.
export async function adminBroadcast(
  { actor, title, body, room },
  { notificationsRepository, pushSender, telegramSender, checkRateLimit },
) {
  // Limite per account, non per IP: un cookie rubato funziona da qualunque
  // indirizzo, quindi il freno deve seguire CHI sta mandando, non da dove.
  // Tre invii ogni mezz'ora bastano a chi lo usa davvero (comunicazioni
  // occasionali) e tengono corto il danno se l'account è compromesso — non
  // lo impediscono, ma un blast di massa richiede più di un colpo solo.
  const puoInviare = await checkRateLimit("broadcast", actor, 3, 1800);
  if (!puoInviare) throw new RateLimitedError("troppi invii, riprova fra un po' (max 3 ogni mezz'ora)");

  const trimmedTitle = String(title || "").trim();
  const trimmedBody = String(body || "").trim();
  if (!trimmedTitle || !trimmedBody) throw new ValidationError("titolo e testo sono obbligatori");

  // Vuoto/assente = tutti. Valorizzato = solo quella camera.
  let parsedRoom = null;
  if (room != null && String(room).trim() !== "") {
    parsedRoom = parseRoomNumber(room);
    if (!parsedRoom) throw new ValidationError("camera non valida");
  }

  const usaPush = pushSender.configured();
  const usaTelegram = telegramSender.configured();
  if (!usaPush && !usaTelegram) throw new ValidationError("nessun canale di notifica configurato sul server");

  const push = { totali: 0, inviati: 0, falliti: 0 };
  const telegram = { totali: 0, inviati: 0, falliti: 0 };

  if (usaPush) {
    const subs = await notificationsRepository.allPushSubs({ room: parsedRoom });
    const dispositivi = Array.isArray(subs) ? subs : [];
    push.totali = dispositivi.length;

    const gone = [];
    await Promise.all(dispositivi.map(async (s) => {
      const esito = await pushSender.send(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        // `tag` diverso da "laundry-reminder" (il default in sw.js): senza,
        // una notifica di lavanderia in arrivo sostituirebbe questa, o
        // viceversa, invece di comparire entrambe.
        { title: trimmedTitle, body: trimmedBody, url: "/", tag: "sysadmin-broadcast" },
      );
      if (esito === "ok") push.inviati++;
      else {
        push.falliti++;
        if (esito === "gone") gone.push(s.id);
      }
    }));

    // Stessa potatura del cron: chi ha disinstallato o revocato il permesso
    // non riceverà mai più nulla, la riga resta solo rumore.
    if (gone.length) {
      await notificationsRepository.prunePushSubs({ ids: gone }).catch(() => {});
    }
  }

  if (usaTelegram) {
    const chats = await notificationsRepository.allTelegramSubs({ room: parsedRoom });
    const lista = Array.isArray(chats) ? chats : [];
    telegram.totali = lista.length;

    await Promise.all(lista.map(async (c) => {
      const esito = await telegramSender.send(c.chat_id, trimmedTitle, trimmedBody);
      if (esito === "ok") telegram.inviati++; else telegram.falliti++;
    }));
  }

  return { ok: true, push, telegram };
}
