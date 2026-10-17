import { bot } from "../bot.js";
import { ADMIN_ID, CHANNEL_ID } from "../../config/environmentals.js";
import { trackMessage } from "../../services/tracker.js";
import { logger } from "../../config/logger.js";
import { BOT_USERNAME } from "../groupLimit.js";

// Admin-only: repost the "open me in private" card to the channel whenever
// people look confused about how to reach the bot. Same copy as the group
// funnel redirect, minus the limit talk.
export const POSTOPEN_TEXT = "Tap below to open me in private.";
export const POSTOPEN_BUTTON_TEXT = "Open me in private";

bot.onText(/\/postopen$/, async (msg) => {
  if (msg.from?.id !== ADMIN_ID) return;
  trackMessage(msg, "command:postopen");

  const chatId = msg.chat.id;

  if (!CHANNEL_ID) {
    bot.sendMessage(chatId, "Channel isn't set up.");
    return;
  }

  try {
    await bot.sendMessage(CHANNEL_ID, POSTOPEN_TEXT, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: POSTOPEN_BUTTON_TEXT,
              url: `https://t.me/${BOT_USERNAME}`,
            },
          ],
        ],
      },
    });
    bot.sendMessage(chatId, "Posted to the channel.");
  } catch (e) {
    logger.error("[postopen] channel post failed:", e);
    bot
      .sendMessage(chatId, "That didn't send. Try again in a bit.")
      .catch(() => {});
  }
});
