import { bot } from "../../bot/index";
import { AttendanceModule } from "../modules/attendance.module";
import { Message } from "node-telegram-bot-api";
import { History } from "../../types";
import { getHistory } from "../../db/history.model";
import { addHistory } from "../../db/history.model";

const agent = new AttendanceModule();

// Detect messages that mention the bot
const isBotMentioned = (text?: string): boolean => {
    return text?.toLowerCase().includes('@nbkristtest_bot') ?? false;
};

// Extract the actual message content without the mention
const extractMessage = (text: string): string => {
    return text.replace(/@nbkristtest_bot\s*/g, '').trim();
};

// Handle the message processing
const handleMentionMessage = async (message: Message): Promise<void> => {
    const userMessage = extractMessage(message.text || '');

    if (!userMessage) {
        await bot.sendMessage(message.chat.id, 'How can I help you?');
        return;
    }

    const userId = message.from ? message.from.id : message.chat.id;

    const userHistory: History = {
        role: 'user',
        content: userMessage,
    };

    const history: History[] = await getHistory(userId.toString());
    await addHistory(userHistory, userId);


    console.log('User history:', history);

    try {
        const response = await agent.chat(userMessage, userId, history);
        await bot.sendMessage(message.chat.id, response, {
            reply_to_message_id: message.message_id,
            parse_mode: 'Markdown',
        });
    } catch (err) {
        console.error('Mention handler error:', err);
        await bot.sendMessage(
            message.chat.id,
            'Sorry, I encountered an error processing your request'
        );
    }
};

// Register message handler
bot.on('message', async (msg) => {
    console.log('Received message:', msg);

    if (msg.chat.type !== "private") {
        if (!msg.text || !isBotMentioned(msg.text)) {
            return;
        }
    }

    await handleMentionMessage(msg);
});
