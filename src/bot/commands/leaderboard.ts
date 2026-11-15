import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { botSecurityHandler } from "../../middleware/security.js";
import { TOO_FAST } from "../replies.js";
import { logger } from "../../config/logger.js";
import { LEADERBOARD_TEXT, leaderboardMarkup } from "../leaderboardRedirect.js";

/**
 * The register lives in the app: searchable, section-aware, and readable at
 * a glance. The chat gets one short card with the way in, never the top ten.
 */
bot.command("leaderboard", async (ctx) => {
  const msg = ctx.message;
  if (!msg) return;

  trackMessage(msg, "command:leaderboard");

  const userId = msg.from?.id ?? msg.chat.id;
  if (!(await botSecurityHandler(userId, "leaderboard"))) {
    if (msg.chat.type === "private") {
      await ctx.reply(TOO_FAST).catch(() => undefined);
    }
    return;
  }

  await ctx
    .reply(LEADERBOARD_TEXT, {
      parse_mode: "HTML",
      reply_markup: leaderboardMarkup(msg.chat.type === "private"),
      reply_parameters: { message_id: msg.message_id },
    })
    .catch((e: Error) =>
      logger.warn("[leaderboard] redirect failed:", e?.message ?? e),
    );
});
