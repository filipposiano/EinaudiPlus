// Invio messaggi Telegram — invariato rispetto a api/_lib/telegram.js
// originale, riorganizzato come "sender" iniettabile.

const TELEGRAM_API = "https://api.telegram.org";

export const telegramSender = {
  configured() {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN);
  },

  /** @returns 'ok' | 'err' */
  async send(chatId, title, body) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !chatId) return "err";
    try {
      const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: `*${title}*\n${body}`, parse_mode: "Markdown" }),
      });
      return res.ok ? "ok" : "err";
    } catch {
      return "err";
    }
  },

  /** Messaggio semplice senza titolo in grassetto — le risposte
   *  conversazionali del webhook (/start, /stop, aiuto). */
  async sendPlain(chatId, text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    try {
      await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
      });
    } catch { /* se non parte, pazienza: e' solo la conferma */ }
  },
};
