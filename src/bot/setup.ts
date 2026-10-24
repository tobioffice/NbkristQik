import TelegramBot from "node-telegram-bot-api";
import { ADMIN_ID } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import { APP_WEBAPP_URL, LIBRARY_WEBAPP_URL } from "../constants/webapp.js";
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

/**
 * The one-tap way in: the app opens on its index page, where every surface
 * lives. While the library is still the admin's, the button opens the shelf
 * itself, because that is the only page the admin is working on.
 */
const menuButtonFor = (openToAll: boolean) => ({
  type: "web_app" as const,
  text: "Open app",
  web_app: { url: openToAll ? APP_WEBAPP_URL : LIBRARY_WEBAPP_URL },
});

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
 * Sets the command lists and the menu button.
 *
 * The app is always the menu button: it holds the register, the roll and the
 * issue desk whatever the library's state, so a student never loses the way
 * in while the shelf is being filled. The command list is the only thing that
 * changes with `LIBRARY_ACCESS`.
 */
export async function setupBot(bot: TelegramBot): Promise<void> {
  const openToAll = libraryOpenToAll();
  const userCommands = openToAll
    ? [...USER_COMMANDS, LIBRARY_COMMAND]
    : USER_COMMANDS;

  await bot.setMyCommands(userCommands).catch((e) => warn("setMyCommands", e));

  // Set once, before the per-chat lists: a default set later can erase the
  // admin's own button.
  await bot
    .setChatMenuButton({
      menu_button: encodeMenuButton(menuButtonFor(openToAll)),
    })
    .catch((e) => warn("setChatMenuButton", e));

  // Admin commands stay out of the public menu. A chat-scoped list replaces
  // the default for that one chat, so the admin keeps the normal commands too.
  if (!ADMIN_ID) return;

  await bot
    .setMyCommands(
      [
        ...userCommands.filter((command) => command.command !== "library"),
        LIBRARY_COMMAND,
        {
          command: "postcheckin",
          description: "Post and pin today's check-in",
        },
      ],
      { scope: { type: "chat", chat_id: ADMIN_ID } },
    )
    .catch((e) => warn("admin setMyCommands", e));
}
