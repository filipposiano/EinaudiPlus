// Invio messaggi Telegram. Estratto da api/cron.js (stesso motivo di
// _lib/push.js): serve anche al broadcast del pannello sistemista, non solo
// ai promemoria lavanderia, e una funzione sola evita due copie che
// divergono nel tempo.

const TELEGRAM_API = "https://api.telegram.org";

/** @returns 'ok' | 'err' */
export async function sendTelegram(chatId, title, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return "err";
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `*${title}*\n${body}`,
        parse_mode: "Markdown",
      }),
    });
    return res.ok ? "ok" : "err";
  } catch {
    return "err";
  }
}

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}
