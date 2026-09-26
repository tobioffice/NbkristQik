import { turso } from "./db.js";
import {
  initStatsTable,
  initUptimeTable,
  initLeaderboardIndexes,
} from "./student_stats.model.js";

/**
 * Single schema entry point — creates every table/index the app assumes.
 * Called once from bot/index.ts before any handlers or the API start.
 */
export const initDatabase = async () => {
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS fallbackResponses (
        id TEXT PRIMARY KEY CHECK(LENGTH(id) <= 50),
        content TEXT
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS tgusers (
        userId TEXT PRIMARY KEY,
        rollNo TEXT,
        semester TEXT,
        department TEXT,
        section TEXT
    );
  `);
  // populated by /syncdb; created here so a fresh DB boots and the
  // studentsnew indexes below don't fail
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS studentsnew (
        roll_no TEXT PRIMARY KEY,
        name TEXT,
        section TEXT,
        branch TEXT,
        year TEXT
    );
  `);
  await initStatsTable();
  await initUptimeTable();
  await initLeaderboardIndexes();
};
