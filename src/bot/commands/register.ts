import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { logger } from "../../config/logger.js";
import { appPageButton } from "../appButton.js";

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
