import { AcadamicTG } from "../../../services/utils/AcadamicTG";
import TelegramBot from "node-telegram-bot-api";

export const sendAttendance = async (bot: TelegramBot, msg: any, rollno: string) => {
    try {
        const chatId = msg.chat.id;
        const student = new AcadamicTG(rollno);
        const message = await bot.sendMessage(chatId, "<code>Fetching Attendance...</code>", {
            parse_mode: "HTML",
            disable_notification: true,
            reply_to_message_id: msg.reply_to_message.message_id,
        });

        const attMessage = await student.getAttendanceMessage();

        bot.editMessageText(attMessage, {
            chat_id: chatId,
            message_id: message.message_id,
            parse_mode: "HTML",
        });

    } catch (error) {
        console.error('Error ', error);
        bot.sendMessage(msg.chat.id, 'An error occurred while processing your request. Please try again later.');
        return;

    }
};

export const sendMidmarks = async (bot: TelegramBot, msg: any, rollno: string) => {
    try {
        const chatId = msg.chat.id;
        const student = new AcadamicTG(rollno);

        const message = await bot.sendMessage(chatId, "<code>Fetching Mid Marks...</code>", {
            parse_mode: "HTML",
            disable_notification: true,
            reply_to_message_id: msg.reply_to_message.message_id,
        })

        const midMessage = await student.getMidmarksMessage();

        bot.editMessageText(midMessage, {
            message_id: message.message_id,
            chat_id: chatId,
            parse_mode: "HTML",
        });

    } catch (error) {
        console.error('Error ', error);
        bot.sendMessage(msg.chat.id, 'An error occurred while processing your request. Please try again later.');
        return;

    }
};