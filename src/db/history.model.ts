import { turso } from "./db";
import { History, HistorySchema } from "../types";
import { ResultSet } from "@libsql/client/.";

export const getHistory = async (chat_id: string): Promise<History[]> => {
    try {
        const historySet = await turso.execute({
            sql: `SELECT * FROM chat_history WHERE chat_id = ? ORDER BY id DESC LIMIT 10`,
            args: [chat_id],
        });

        if (!historySet.rows[0]) {
            return []; // Return an empty array if no history is found
        }

        const history: History[] = historySet.rows.map((row) => ({
            role: row.role as 'user' | 'model' | 'system',
            content: row.content?.toString() || '',
        }));

        return history.reverse(); // Reverse to maintain chronological order
    } catch (error) {
        console.error('Error fetching history:', error);
        throw error;
    }
}

export const addHistory = async (history: History, chat_id: number): Promise<ResultSet> => {
    try {
        HistorySchema.parse({ ...history, chat_id }); // Validate the history object
        const result = await turso.execute({
            sql: `INSERT INTO chat_history (role, content, chat_id) VALUES (?, ?, ?)`,
            args: [history.role, history.content, chat_id],
        });

        return result

    } catch (error) {
        console.error('Error adding history:', error);
        throw error;
    }
}
