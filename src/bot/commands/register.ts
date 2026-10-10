import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { REGISTER_WEBAPP_URL } from "../../constants/webapp.js";

bot.onText(/\/register/, (msg) => {
  trackMessage(msg, "command:register");
  bot.sendMessage(
    msg.chat.id,
    `👤 <b>Register your roll number</b> (optional)\n\n` +
      `Set it once and <code>/attendance</code>, <code>/midmarks</code>, <code>/bunk</code> answer instantly, no roll to type.\n\n` +
      `<i>You can edit it anytime.</i>`,
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
