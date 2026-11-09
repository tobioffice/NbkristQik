import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { botSecurityHandler } from "../../middleware/security.js";
import { leaderboardText } from "../academics/leaderboardCard.js";
import { TOO_FAST } from "../replies.js";
import { logger } from "../../config/logger.js";

bot.onText(/\/leaderboard/, async (msg) => {
  trackMessage(msg, "command:leaderboard");

  const userId = msg.from?.id ?? msg.chat.id;
  if (!(await botSecurityHandler(userId, "leaderboard"))) {
    if (msg.chat.type === "private") {
      await bot.sendMessage(msg.chat.id, TOO_FAST).catch(() => undefined);
    }
    return;
  }

  try {
    const text = await leaderboardText({
      userId,
      withNames: msg.chat.type === "private",
    });
    await bot.sendMessage(msg.chat.id, text, {
      parse_mode: "HTML",
      reply_to_message_id: msg.message_id,
    });
  } catch (e) {
    logger.warn(
      "[leaderboard] register failed:",
      e instanceof Error ? e.message : e,
    );
    await bot
      .sendMessage(
        msg.chat.id,
        "Could not read the register. Try again in a minute.",
        { reply_to_message_id: msg.message_id },
      )
      .catch(() => undefined);
  }
});
