import type { InlineKeyboardButton } from "node-telegram-bot-api";
import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { REGISTER_WEBAPP_URL } from "../../constants/webapp.js";
import { logger } from "../../config/logger.js";

/**
 * A button that opens one page of the app.
 *
 * Telegram only accepts `web_app` buttons in private chats and rejects the
 * whole message in a group. There the same button becomes a plain link, so
 * the command still answers and the page still opens in a browser.
 */
export const appPageButton = (
  text: string,
  url: string,
  isPrivate: boolean,
): InlineKeyboardButton =>
  isPrivate ? { text, web_app: { url } } : { text, url };

bot.onText(/\/register/, (msg) => {
  trackMessage(msg, "command:register");

  const isPrivate = msg.chat.type === "private";

  bot
    .sendMessage(
      msg.chat.id,
      `Save your roll number once (you can change it anytime).\n\n` +
        `Then <code>/attendance</code>, <code>/midmarks</code> and <code>/bunk</code> answer instantly, no typing.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              appPageButton(
                "👤 Open registration",
                REGISTER_WEBAPP_URL,
                isPrivate,
              ),
            ],
          ],
        },
      },
    )
    .catch((e: Error) =>
      logger.warn("[register] registration message failed:", e?.message ?? e),
    );
});
