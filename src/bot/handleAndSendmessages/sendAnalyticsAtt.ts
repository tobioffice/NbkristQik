import TelegramBot from "node-telegram-bot-api";
import { AttendaceAnylCached } from "../../services/student.utils/Analytics/AttendaceAnylCached.js";

export const sendAnalyticsMessage = async (
  bot: TelegramBot,
  msg: TelegramBot.Message,
  rollno: string,
  isMember: boolean,
) => {
  const chatId = msg.chat.id;

  const message = await bot.sendMessage(chatId, "Syncing 10 week data...", {
    parse_mode: "HTML",
  });

  const attendaceAnaly = new AttendaceAnylCached(rollno);
  const anylData = (await attendaceAnaly.getAnylDataCashed()).reverse();
  if (!anylData) {
    bot.sendMessage(chatId, "Analytics not available for now.");
    return;
  }
  let finalMessage = `<b>Attendance Analytics for ${rollno}:</b>\n\n`;
  const maxPercentage = Math.max(
    ...anylData.map((data) => data.attendace.percentage),
  );

  const minPercentage = Math.min(
    ...anylData.map((data) => data.attendace.percentage),
  );
  // console.log("max percentage ", maxPercentage);
  // console.log("min percentage ", minPercentage);

  // const BlockEmojis = ["⬜", "🟩", "🟨", "🟧", "🟥"];
  const whiteBlock = "⬜";

  // finalMessage += `${maxPercentage}%\n`;
  for (let i = 10; i >= 1; i--) {
    let currLine = "";

    let gotHit = false;
    let percentage = 0;

    for (const data of anylData) {
      const percentageOutof10 = Math.round(
        ((data.attendace.percentage - minPercentage) /
          (maxPercentage - minPercentage)) *
          10,
      );

      if (i === percentageOutof10) {
        if (!gotHit) {
          gotHit = true;
          percentage = data.attendace.percentage;
        }
      }
      if (i <= percentageOutof10) {
        currLine += "🟨";
      } else {
        currLine += whiteBlock;
      }
    }
    if (gotHit) {
      currLine += ` - ${percentage}%`;
    }
    finalMessage += `${currLine}\n`;
  }

  for (const _ of anylData) {
    finalMessage += "🟨";
  }

  finalMessage += ` - ${minPercentage}%` + "\n\n";
  finalMessage +=
    "Weekly Attendance data, the rightmost bar is the most recent week.\n";

  !isMember && (finalMessage += `\nJoin @nbkrist_qik for more updates !`);
  bot.editMessageText(finalMessage, {
    chat_id: chatId,
    message_id: message.message_id,
    parse_mode: "HTML",
  });
};
