import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { botSecurityHandler } from "../../middleware/security.js";
import { leaderboardText } from "../academics/leaderboardCard.js";
import { TOO_FAST } from "../replies.js";
import { logger } from "../../config/logger.js";

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

  try {
    const text = await leaderboardText({
      userId,
      withNames: msg.chat.type === "private",
    });
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_parameters: { message_id: msg.message_id },
    });
  } catch (e) {
    logger.warn(
      "[leaderboard] register failed:",
      e instanceof Error ? e.message : e,
    );
    await ctx
      .reply("Could not read the register. Try again in a minute.", {
        reply_parameters: { message_id: msg.message_id },
      })
      .catch(() => undefined);
  }
});
