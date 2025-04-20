import { turso } from "./db";

async function setupDatabase() {
    try {
        await turso.execute(`CREATE TABLE IF NOT EXISTS studentsnew (
                roll_no TEXT PRIMARY KEY,
                name TEXT,
                section TEXT,
                branch TEXT,
                year INTEGER
            )`);

        await turso.execute(`CREATE TABLE IF NOT EXISTS chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT,
                content TEXT,
                chat_id INTEGER
            )`);

        console.log('Database setup complete');
    } catch (error) {
        console.error('Error setting up database:', error);
    }
}
setupDatabase().then(() => {
    console.log('Database setup finished');
});