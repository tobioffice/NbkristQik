import type { InlineKeyboardMarkup } from "node-telegram-bot-api";
import { appPageButton } from "./appButton.js";

/**
 * The register is a page, not a chat dump.
 *
 * The command and the legacy Leaderboard button both answer with one short
 * card and an app button. A group gets the direct link; a private chat gets
 * the web_app button. No classmate's name or figure is printed in the room.
 */
export const LEADERBOARD_TEXT =
  "🏆 <b>Attendance register</b>\n" +
  "Search by roll, switch to mid marks, and see where you stand.";

export const leaderboardMarkup = (
  isPrivate: boolean,
): InlineKeyboardMarkup => ({
  inline_keyboard: [[appPageButton("Open the register", "rank", isPrivate)]],
});
