import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";

bot.onText(/\/leaderboard/, (msg) => {
  trackMessage(msg, "command:leaderboard");
  const helpMessage = "Click on the button below to view the leaderboard";

  bot.sendMessage(msg.chat.id, helpMessage, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "View Leaderboard 🏆",
            url: "https://t.me/NbkristQik_bot/nbkristqik_leaderboard",
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
    parse_mode: "HTML",
  });
});
