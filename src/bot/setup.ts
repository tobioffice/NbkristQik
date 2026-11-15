import type {
  Api,
  BotCommand,
  BotCommandScope,
  MenuButton,
  SetMyCommandsParams,
} from "node-telegram-bot-api";
import { ADMIN_ID } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import { APP_WEBAPP_URL } from "../constants/webapp.js";
import { libraryOpenToAll } from "../services/library/access.js";

// Telegram expects command names WITHOUT the leading slash.
const USER_COMMANDS: BotCommand[] = [
  { command: "start", description: "Start the bot" },
  { command: "attendance", description: "Check your attendance" },
  { command: "midmarks", description: "Check your mid-term marks" },
  { command: "bunk", description: "See your bunk plan" },
  { command: "register", description: "Save your roll number" },
  { command: "report", description: "Tell me something's broken" },
  { command: "help", description: "How this works" },
  { command: "leaderboard", description: "Print the attendance register" },
  { command: "five", description: "Play today's five" },
  { command: "league", description: "This week's section board" },
  { command: "duel", description: "Your duel record" },
];

const LIBRARY_COMMAND: BotCommand = {
  command: "library",
  description: "Read your subject material",
};

/**
 * Commands a group should answer privately.
 *
 * Telegram marks these as ephemeral, so the command itself is invisible to the
 * room and the bot can answer the sender alone. The three lookups are the only
 * commands that carry a student's own figures.
 */
const EPHEMERAL_COMMANDS = new Set(["attendance", "midmarks", "bunk"]);

/** The same list, with the private lookups marked ephemeral. */
const groupCommands = (commands: BotCommand[]): BotCommand[] =>
  commands.map((command) =>
    EPHEMERAL_COMMANDS.has(command.command)
      ? { ...command, is_ephemeral: true }
      : command,
  );

/**
 * The one-tap way in: the app opens on its index page, where every surface
 * lives. The library's state never changes where this goes — a student must
 * always be able to reach the register, the roll and the issue desk.
 */
const MENU_BUTTON: MenuButton = {
  type: "web_app",
  text: "Open app",
  web_app: { url: APP_WEBAPP_URL },
};

/** The API surface the setup needs; the app and the tests both provide it. */
type SetupApi = Pick<Api, "setMyCommands" | "setChatMenuButton">;

const warn = (what: string, e: unknown): void =>
  logger.warn(`[bot] ${what} failed:`, (e as Error)?.message ?? e);

const setCommands = async (
  api: SetupApi,
  commands: BotCommand[],
  scope?: BotCommandScope,
): Promise<void> => {
  const params: SetMyCommandsParams = {
    commands,
    ...(scope ? { scope } : {}),
  };
  await api.setMyCommands(params).catch((e) => warn("setMyCommands", e));
};

/**
 * Sets the command lists and the menu button.
 *
 * The app is always the menu button: it holds the register, the roll and the
 * issue desk whatever the library's state, so a student never loses the way
 * in while the shelf is being filled. The command list is the only thing that
 * changes with `LIBRARY_ACCESS`.
 */
export async function setupBot(api: SetupApi): Promise<void> {
  const openToAll = libraryOpenToAll();
  const userCommands = openToAll
    ? [...USER_COMMANDS, LIBRARY_COMMAND]
    : USER_COMMANDS;

  await setCommands(api, userCommands);

  // Groups get the same list, with the three private lookups marked
  // ephemeral. The default list still serves private chats, where there is
  // nobody else to hide a figure from.
  await setCommands(api, groupCommands(userCommands), {
    type: "all_group_chats",
  });

  // Set once, before the per-chat lists: a default set later can erase the
  // admin's own button.
  await api
    .setChatMenuButton({ menu_button: MENU_BUTTON })
    .catch((e) => warn("setChatMenuButton", e));

  // Admin commands stay out of the public menu. A chat-scoped list replaces
  // the default for that one chat, so the admin keeps the normal commands too.
  if (!ADMIN_ID) return;

  await setCommands(api, [...USER_COMMANDS, LIBRARY_COMMAND], {
    type: "chat",
    chat_id: ADMIN_ID,
  });
}
