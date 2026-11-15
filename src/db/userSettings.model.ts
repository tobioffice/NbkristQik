import { turso } from "./db.js";
import { logger } from "../config/logger.js";

/**
 * The chat theme the Mini App last saw.
 *
 * The bot's bar image is baked, so a transparent PNG would be flattened to
 * white by Telegram's photo pipeline. The app sends its `themeParams.bg_color`
 * once; the attendance card then draws the strip on that exact colour.
 */
export type ThemeScheme = "light" | "dark";

export interface UserTheme {
  bgColor: string;
  colorScheme: ThemeScheme;
}

export const initUserSettingsTable = async (): Promise<void> => {
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS user_settings (
      userId TEXT PRIMARY KEY,
      theme_bg TEXT,
      color_scheme TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
};

export const setUserTheme = async (
  userId: number | string,
  bgColor: string,
  colorScheme: ThemeScheme,
): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO user_settings (userId, theme_bg, color_scheme, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(userId) DO UPDATE SET
            theme_bg = excluded.theme_bg,
            color_scheme = excluded.color_scheme,
            updated_at = datetime('now')`,
    args: [String(userId), bgColor, colorScheme],
  });
};

/** The last theme for this user, or null when the app has never synced one. */
export const getUserTheme = async (
  userId: number | string,
): Promise<UserTheme | null> => {
  try {
    const result = await turso.execute({
      sql: `SELECT theme_bg, color_scheme FROM user_settings WHERE userId = ?`,
      args: [String(userId)],
    });
    const row = result.rows[0];
    if (!row || row.theme_bg == null) return null;
    return {
      bgColor: String(row.theme_bg),
      colorScheme: row.color_scheme === "light" ? "light" : "dark",
    };
  } catch (e) {
    // A missing table before the migration, or a DB hiccup, must not stop an
    // attendance card: the image falls back to the dark strip.
    logger.debug(
      "[userSettings] theme read skipped:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
};
