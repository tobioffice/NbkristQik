import { bot } from "../bot.js";
import { ADMIN_ID, CHANNEL_ID } from "../../config/environmentals.js";
import { trackMessage } from "../../services/tracker.js";
import { logger } from "../../config/logger.js";
import { botLink } from "../../constants/telegram.js";

// Admin-only: repost the "open me in private" card to the channel whenever
// people look confused about how to reach the bot. Same copy as the group
// funnel redirect, minus the limit talk.
export const POSTOPEN_TEXT = "Tap below to open me in private.";
export const POSTOPEN_BUTTON_TEXT = "Open me in private";

bot.command("postopen", async (ctx) => {
  const msg = ctx.message;
  if (!msg || msg.from?.id !== ADMIN_ID) return;

  trackMessage(msg, "command:postopen");

  if (!CHANNEL_ID) {
    await ctx.reply("Channel isn't set up.");
    return;
  }

  try {
    await bot.api.sendMessage({
      chat_id: CHANNEL_ID,
      text: POSTOPEN_TEXT,
      reply_markup: {
        inline_keyboard: [[{ text: POSTOPEN_BUTTON_TEXT, url: botLink() }]],
      },
    });
    await ctx.reply("Posted to the channel.");
  } catch (e) {
    logger.error("[postopen] channel post failed:", e);
    await ctx.reply("That didn't send. Try again in a bit.").catch(() => {});
  }
});
