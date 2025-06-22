import { bot } from "../index";
import { sendAttendance, sendMidmarks } from "./utils/studentActions";
import { ROLL_REGEX } from "../../constants/index";

try {
    bot.onText(ROLL_REGEX, async (msg) => {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, "Select an option:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Attendance 🚀', callback_data: 'att_' + msg.text }],
                    [{ text: 'Mid Marks 📊', callback_data: 'mid_' + msg.text }]
                ]
            },
            reply_to_message_id: msg.message_id
        });
    })
} catch (error) {
    console.error('Error ', error);

}

//HANDLE CALLBACK QUERY
bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data || '';
    const msg = callbackQuery.message;

    if (!msg) return;

    try {
        await bot.deleteMessage(msg.chat.id, msg.message_id);
    }
    catch (error) {
        console.error('Error deleting message:', error);
    }

    if (data.startsWith('att_')) {
        sendAttendance(bot, msg, data.split('_')[1]);
    }

    else if (data.startsWith('mid_')) {
        sendMidmarks(bot, msg, data.split('_')[1]);
    }


    try {
        await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
        console.error('Error answering callback query:', error);
    }
});
