import type { InlineKeyboardButton } from "node-telegram-bot-api";
import { appPageUrl, type AppPage } from "../constants/webapp.js";

/**
 * A button that opens one page of the app.
 *
 * Telegram only accepts `web_app` buttons in private chats and rejects the
 * whole message in a group. There the same section becomes a direct link,
 * which opens the Mini App inside Telegram instead of handing the student to
 * a browser.
 */
export const appPageButton = (
  text: string,
  page: AppPage,
  isPrivate: boolean,
): InlineKeyboardButton =>
  isPrivate
    ? { text, web_app: { url: appPageUrl(page, "web_app") }, style: "primary" }
    : { text, url: appPageUrl(page, "direct"), style: "primary" };
