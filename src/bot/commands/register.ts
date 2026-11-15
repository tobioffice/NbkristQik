import type { InlineKeyboardButton } from "node-telegram-bot-api";
import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { appPageUrl, type AppPage } from "../../constants/webapp.js";
import { logger } from "../../config/logger.js";

/**
 * A button that opens one page of the app.
 *
 * Telegram only accepts `web_app` buttons in private chats and rejects the
 * whole message in a group. There the same section becomes a direct link,
 * which opens the Mini App inside Telegram instead of handing the student to
 * a browser.
 */
export const appPageButton = (
  text: string,
  page: AppPage,
  isPrivate: boolean,
): InlineKeyboardButton =>
  isPrivate
    ? { text, web_app: { url: appPageUrl(page, "web_app") }, style: "primary" }
    : { text, url: appPageUrl(page, "direct"), style: "primary" };

bot.command("register", (ctx) => {
  const msg = ctx.message;
  if (!msg) return;

  trackMessage(msg, "command:register");
  const isPrivate = msg.chat.type === "private";

  return ctx
    .reply(
      `Save your roll number once (you can change it anytime).\n\n` +
        `Then <code>/attendance</code>, <code>/midmarks</code> and <code>/bunk</code> answer instantly, no typing.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [appPageButton("👤 Open registration", "profile", isPrivate)],
          ],
        },
      },
    )
    .catch((e: Error) =>
      logger.warn("[register] registration message failed:", e?.message ?? e),
    );
});
