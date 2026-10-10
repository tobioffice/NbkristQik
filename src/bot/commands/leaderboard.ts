import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { WEBAPP_URL } from "../../constants/webapp.js";

bot.onText(/\/leaderboard/, (msg) => {
  trackMessage(msg, "command:leaderboard");
  const helpMessage = "Tap the button below to see who's on top! 🏆";

  bot.sendMessage(msg.chat.id, helpMessage, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "View Leaderboard 🏆",
            url: WEBAPP_URL,
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
    parse_mode: "HTML",
  });
});
