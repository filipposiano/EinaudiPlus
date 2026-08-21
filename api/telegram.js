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

import { rpc } from "./_lib/db.js";
import { readBody, json, methodOk } from "./_lib/http.js";

const API = "https://api.telegram.org";

async function reply(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
  } catch { /* se non parte, pazienza: e' solo la conferma */ }
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
  // Se il segreto NON e' configurato si chiude, non si apre. Prima la
  // condizione era `if (secret && ...)`: senza variabile d'ambiente il
  // controllo spariva e l'endpoint accettava POST da chiunque. Il caso non e'
  // teorico — un deployment di preview a cui manchi la variabile e' un webhook
  // aperto che parla con lo STESSO database di produzione, perche' un database
  // di staging separato non esiste. Da li' bastava un `/stop` con il chat_id
  // di qualcun altro per spegnergli i promemoria.
  //
  // Fallire chiuso e' anche il comportamento che gia' hanno cron.js e
  // health.js: questo era l'unico dei tre a divergere.
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
      await rpc("telegram_unlink", { p_chat_id: String(chatId) });
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

      const out = await rpc("telegram_link", { p_code: code, p_chat_id: String(chatId) });
      await reply(
        chatId,
        out?.ok
          ? `Collegato alla camera *${out.room}*. Ti avviserò quando sta per iniziare il tuo turno.`
          : "Codice non valido o già usato. Aprine uno nuovo dall'app."
      );
      return json(res, 200, { ok: true });
    }

    // Un codice incollato da solo, senza /start: capita, e vale accettarlo.
    if (/^[A-Z0-9]{8}$/i.test(text)) {
      const out = await rpc("telegram_link", { p_code: text, p_chat_id: String(chatId) });
      await reply(
        chatId,
        out?.ok
          ? `Collegato alla camera *${out.room}*. Ti avviserò quando sta per iniziare il tuo turno.`
          : "Codice non valido o già usato. Aprine uno nuovo dall'app."
      );
      return json(res, 200, { ok: true });
    }

    await reply(chatId, AIUTO);
    return json(res, 200, { ok: true });
  } catch (err) {
    console.error("[telegram]", err.message);
    return json(res, 200, { ok: true });   // mai far ritentare Telegram
  }
}
