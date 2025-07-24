import { bot } from "../index";
import { sendAttendanceOrMidMarks } from "./utils/studentActions";
import { ROLL_REGEX } from "../../constants/index";
import { checkMembership } from "../../services/utils/checkMembership";
import { CHANNEL_ID } from "../../config/environmentals";

const sendJoinChannelMsg = async (chatId: number) => {
    const channelName = CHANNEL_ID.slice(1)
    await bot.sendMessage(chatId, "Join the channel to use in private ‼️", {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: `Join @${channelName}`,
                        url: `https://t.me/${channelName}`
                    }
                ]
            ]
        }
    });
};

try {
    bot.onText(ROLL_REGEX, async (msg) => {
        const isMember = await checkMembership(msg.from?.id || msg.chat.id)

        if (!isMember && msg.chat.id != -1002435023187) {
            await sendJoinChannelMsg(msg.from?.id || msg.chat.id);
            return;
        }

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

    const isMember = await checkMembership(msg.from?.id || msg.chat.id)

    if (!isMember && msg.chat.id != -1002435023187) {
        await sendJoinChannelMsg(msg.from?.id || msg.chat.id);
        return;
    }

    try {
        await bot.deleteMessage(msg.chat.id, msg.message_id);
    }
    catch (error) {
        console.error('Error deleting message:', error);
    }

    if (data.startsWith('att_')) {
        sendAttendanceOrMidMarks(bot, msg, data.split('_')[1], 'att');
    }

    else if (data.startsWith('mid_')) {
        sendAttendanceOrMidMarks(bot, msg, data.split('_')[1], 'mid');
    }


    try {
        await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
        console.error('Error answering callback query:', error);
    }
});
