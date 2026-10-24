import TelegramBot from "node-telegram-bot-api";
import { ADMIN_ID } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import { LIBRARY_WEBAPP_URL } from "../constants/webapp.js";
import { libraryOpenToAll } from "../services/library/access.js";

// Telegram expects command names WITHOUT the leading slash.
const USER_COMMANDS = [
  { command: "start", description: "Start the bot" },
  { command: "attendance", description: "Check your attendance" },
  { command: "midmarks", description: "Check your mid-term marks" },
  { command: "bunk", description: "See your bunk plan" },
  { command: "register", description: "Save your roll number" },
  { command: "report", description: "Tell me something's broken" },
  { command: "help", description: "How this works" },
  { command: "leaderboard", description: "View the leaderboard" },
];

const LIBRARY_COMMAND = {
  command: "library",
  description: "Read your subject material",
};

/** The one-tap way into the library, for a private chat. */
const LIBRARY_MENU_BUTTON = {
  type: "web_app" as const,
  text: "Library",
  web_app: { url: LIBRARY_WEBAPP_URL },
};

/**
 * The Bot API wants `menu_button` as a JSON object. node-telegram-bot-api
 * turns a nested object into `menu_button[type]=…` form fields, which
 * Telegram accepts with `true` and then ignores, so the field is encoded
 * here itself.
 */
const encodeMenuButton = (button: object): TelegramBot.MenuButton =>
  JSON.stringify(button) as unknown as TelegramBot.MenuButton;

const warn = (what: string, e: unknown): void =>
  logger.warn(`[bot] ${what} failed:`, (e as Error)?.message ?? e);

/**
 * Sets the command lists and the menu buttons.
 *
 * The calls are awaited in order because the menu button has a default and
 * a per-chat override: the default reset must land first, or it can erase
 * the admin's own button.
 */
export async function setupBot(bot: TelegramBot): Promise<void> {
  const openToAll = libraryOpenToAll();
  const userCommands = openToAll
    ? [...USER_COMMANDS, LIBRARY_COMMAND]
    : USER_COMMANDS;

  await bot.setMyCommands(userCommands).catch((e) => warn("setMyCommands", e));

  // The menu button opens the library once every student may read, and is
  // reset to the command list while the library is still the admin's. The
  // reset matters: a button set by an earlier deploy would otherwise stay.
  await bot
    .setChatMenuButton({
      menu_button: encodeMenuButton(
        openToAll ? LIBRARY_MENU_BUTTON : { type: "default" },
      ),
    })
    .catch((e) => warn("setChatMenuButton", e));

  // Admin commands stay out of the public menu. A chat-scoped list replaces
  // the default for that one chat, so the admin keeps the normal commands too.
  if (!ADMIN_ID) return;

  await bot
    .setMyCommands(
      [
        ...userCommands.filter((c) => c.command !== "library"),
        LIBRARY_COMMAND,
        {
          command: "postcheckin",
          description: "Post and pin today's check-in",
        },
      ],
      { scope: { type: "chat", chat_id: ADMIN_ID } },
    )
    .catch((e) => warn("admin setMyCommands", e));

  // and a Library button in the admin's own chat, even while closed: set it
  // last, so nothing resets it afterwards
  if (!openToAll) {
    await bot
      .setChatMenuButton({
        chat_id: ADMIN_ID,
        menu_button: encodeMenuButton(LIBRARY_MENU_BUTTON),
      })
      .catch((e) => warn("admin setChatMenuButton", e));
  }
}
