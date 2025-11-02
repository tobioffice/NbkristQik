import TelegramBot from "node-telegram-bot-api";
import { AttendaceAnylCached } from "../../services/student.utils/Analytics/AttendaceAnylCached.js";

export const sendAnalyticsMessage = async (
  bot: TelegramBot,
  msg: TelegramBot.Message,
  rollno: string,
  isMember: boolean
) => {
  const chatId = msg.chat.id;

  const message = await bot.sendMessage(chatId, "Syncing 10 week data...", {
    parse_mode: "HTML",
  });

  const attendaceAnaly = new AttendaceAnylCached(rollno);
  const anylData = (await attendaceAnaly.getAnylDataCashed()).reverse();

  // console.log(anylData);

  if (!anylData) {
    bot.sendMessage(chatId, "Analytics not available for now.");
    return;
  }
  let finalMessage = `<b>Attendance Analytics for ${rollno}:</b>\n\n`;
  const maxPercentage = Math.max(
    ...anylData.map((data) => data.attendace.percentage)
  );

  const minPercentage = Math.min(
    ...anylData.map((data) => data.attendace.percentage)
  );
  console.log("max percentage ", maxPercentage);
  console.log("min percentage ", minPercentage);
  const BlockEmojis = ["⬜", "🟩", "🟨", "🟥"];

  for (const data of anylData) {
    // console.log(finalMessage);
    const outOf = 5;
    const percenatageOutof =
      minPercentage === maxPercentage
        ? outOf
        : Math.round(
            ((data.attendace.percentage - minPercentage) /
              (maxPercentage - minPercentage)) *
              outOf
          );

    // console.log(percenatageOutof7);

    const appropriateBlockIndex =
      data.attendace.percentage >= 74
        ? 1
        : data.attendace.percentage >= 50
        ? 2
        : 3;

    const attBlocks =
      BlockEmojis[appropriateBlockIndex].repeat(percenatageOutof);

    const whiteblocks = BlockEmojis[0].repeat(outOf - percenatageOutof);

    finalMessage +=
      BlockEmojis[appropriateBlockIndex] +
      attBlocks +
      whiteblocks +
      ` - <code>${data.attendace.percentage.toFixed(
        1
      )}%</code> <b>(${data.attdate.substring(0, 5)})</b>\n`;
  }

  finalMessage += "\n<b>Format:</b>\n[Visual Bar] - [Percentage] - [Date]\n";

  !isMember && (finalMessage += `\nJoin @nbkrist_qik for more updates !`);
  bot.editMessageText(finalMessage, {
    chat_id: chatId,
    message_id: message.message_id,
    parse_mode: "HTML",
  });
};
