// Webhook del bot Telegram.
//
// Riceve i messaggi e gestisce due comandi: /start <codice> per collegare la
// chat a una camera, /stop per scollegarla. L'invio dei promemoria non passa
// da qui: lo fa /api/cron.
//
// Registrazione del webhook (una volta sola):
//   curl -F "url=https://<dominio>/api/telegram" \
//        -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
//        https://api.telegram.org/bot<TOKEN>/setWebhook
//
// Il collegamento/scollegamento vive ora nel modulo Notifications — vedi
// refactor-enterprise/ARCHITETTURA-ENTERPRISE.md. Niente wrapHandler qui:
// questo endpoint ha un contratto diverso da tutti gli altri (risponde
// SEMPRE 200 a Telegram, anche in caso di errore, per non farlo ritentare
// in loop) — il logger strutturato va bene comunque, la forma della
// risposta no.

import { readBody, json, methodOk } from "./_lib/http.js";
import { linkTelegramByCode, unlinkTelegram, sendPlainTelegramMessage } from "../src/modules/notifications/index.js";
import { createLogger } from "../src/shared/logging/logger.js";

const logger = createLogger("telegram");

async function reply(chatId, text) {
  return sendPlainTelegramMessage(chatId, text);
}

const AIUTO =
  "Ciao! Ti mando un promemoria quando sta per iniziare il tuo turno di lavanderia.\n\n" +
  "Per collegarti apri EinaudiPlus, vai nelle notifiche e tocca *Collega Telegram*: " +
  "ti darà un codice da incollare qui.\n\n" +
  "Per smettere in qualsiasi momento: /stop";

export default async function handler(req, res) {
  if (!methodOk(req, res, ["POST"])) return;

  // Telegram rimanda l'header che abbiamo impostato con setWebhook. Senza,
  // chiunque conosca l'URL potrebbe inviare aggiornamenti falsi.
  //
  // Se il segreto NON e' configurato si chiude, non si apre — un deployment
  // di preview a cui manchi la variabile non deve diventare un webhook aperto
  // che parla con lo STESSO database di produzione.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    return json(res, 401, { ok: false });
  }

  const update = readBody(req);
  const msg = update.message || update.edited_message;
  const chatId = msg?.chat?.id;
  const text = String(msg?.text || "").trim();

  // A Telegram si risponde SEMPRE 200: un errore lo farebbe ritentare in loop.
  if (!chatId) return json(res, 200, { ok: true });

  try {
    if (/^\/stop\b/i.test(text)) {
      await unlinkTelegram(String(chatId));
      await reply(chatId, "Fatto, non ti scriverò più. Se cambi idea, ricollegati dall'app.");
      return json(res, 200, { ok: true });
    }

    const start = text.match(/^\/start(?:\s+(\S+))?/i);
    if (start) {
      const code = start[1];
      if (!code) {
        await reply(chatId, AIUTO);
        return json(res, 200, { ok: true });
      }

      const out = await linkTelegramByCode(code, String(chatId));
      await reply(
        chatId,
        out?.ok
          ? `Collegato alla camera *${out.room}*. Ti avviserò quando sta per iniziare il tuo turno.`
          : "Codice non valido o già usato. Aprine uno nuovo dall'app.",
      );
      return json(res, 200, { ok: true });
    }

    // Un codice incollato da solo, senza /start: capita, e vale accettarlo.
    if (/^[A-Z0-9]{8}$/i.test(text)) {
      const out = await linkTelegramByCode(text, String(chatId));
      await reply(
        chatId,
        out?.ok
          ? `Collegato alla camera *${out.room}*. Ti avviserò quando sta per iniziare il tuo turno.`
          : "Codice non valido o già usato. Aprine uno nuovo dall'app.",
      );
      return json(res, 200, { ok: true });
    }

    await reply(chatId, AIUTO);
    return json(res, 200, { ok: true });
  } catch (err) {
    logger.error("errore nel webhook", { message: err.message, chatId });
    return json(res, 200, { ok: true }); // mai far ritentare Telegram
  }
}
