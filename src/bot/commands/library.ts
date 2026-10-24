import type { Message } from "node-telegram-bot-api";
import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { canOpenLibrary } from "../../services/library/access.js";
import { LIBRARY_WEBAPP_URL } from "../../constants/webapp.js";

/**
 * The library entry, shared by /library and by the channel post's deep link
 * (`https://t.me/NbkristQik_bot?start=library`), so the button lands the
 * student on the same one-tap open.
 *
 * The link opens the library section of the app. Until the shelf is filled
 * only the admin can open it; anyone else gets a plain line in private, and
 * nothing at all in a group.
 */
export const sendLibraryEntry = (msg: Message): void => {
  const from = msg.from?.id;
  if (!from || !canOpenLibrary(from)) {
    if (msg.chat.type === "private") {
      bot.sendMessage(
        msg.chat.id,
        "The library opens soon. I'll tell you here when it does.",
      );
    }
    return;
  }

  const isPrivate = msg.chat.type === "private";

  bot.sendMessage(msg.chat.id, "Your subjects, ready to read.", {
    reply_markup: {
      inline_keyboard: [
        [
          isPrivate
            ? { text: "Open the library", web_app: { url: LIBRARY_WEBAPP_URL } }
            : { text: "Open the library", url: LIBRARY_WEBAPP_URL },
        ],
      ],
    },
  });
};

bot.onText(/^\/library$/, (msg) => {
  trackMessage(msg, "command:library");
  sendLibraryEntry(msg);
});
