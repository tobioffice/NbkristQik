import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { WEBAPP_URL } from "../../constants/webapp.js";

bot.onText(/\/leaderboard/, (msg) => {
  trackMessage(msg, "command:leaderboard");
  // web_app buttons are private-only; groups get a plain link
  const leaderboardButton =
    msg.chat.type === "private"
      ? { text: "View Leaderboard 🏆", web_app: { url: WEBAPP_URL } }
      : { text: "View Leaderboard 🏆", url: WEBAPP_URL };

  bot.sendMessage(msg.chat.id, "See who's on top.", {
    reply_markup: {
      inline_keyboard: [[leaderboardButton]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
    parse_mode: "HTML",
  });
});
