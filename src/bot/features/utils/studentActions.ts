import { AcademicTG } from "../../../services/student.utils/AcademicTG.js";
import TelegramBot from "node-telegram-bot-api";
import { Signal } from "../../../constants/index.js";

export const sendAttendanceOrMidMarks = async (
  bot: TelegramBot,
  msg: any,
  rollno: string,
  signal: Signal,
) => {
  try {
    const chatId = msg.chat.id;
    const student = new AcademicTG(rollno);
    const message = await bot.sendMessage(
      chatId,
      `<code>Fetching ${
        signal == "att" ? "Attendance" : "Mid marks"
      }...</code>`,
      {
        parse_mode: "HTML",
        disable_notification: true,
        reply_to_message_id: msg.reply_to_message.message_id,
      },
    );

    const finalMessage =
      signal == "att"
        ? await student.getAttendanceMessage()
        : await student.getMidmarksMessage();

    bot.editMessageText(finalMessage, {
      chat_id: chatId,
      message_id: message.message_id,
      parse_mode: "HTML",
    });
  } catch (error) {
    console.log("Error in sendAttendanceOrMidMarks:", error);
    bot.sendMessage(
      msg.chat.id,
      "An error occurred while processing your request. Please try again later.",
    );
    return;
  }
};
