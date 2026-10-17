import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { REGISTER_WEBAPP_URL } from "../../constants/webapp.js";

bot.onText(/\/register/, (msg) => {
  trackMessage(msg, "command:register");
  bot.sendMessage(
    msg.chat.id,
    `Save your roll number once (you can change it anytime).\n\n` +
      `Then <code>/attendance</code>, <code>/midmarks</code> and <code>/bunk</code> answer instantly, no typing.`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "👤 Open registration",
              web_app: { url: REGISTER_WEBAPP_URL },
            },
          ],
        ],
      },
    },
  );
});
