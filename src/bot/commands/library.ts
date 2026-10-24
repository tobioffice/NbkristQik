import type { Message } from "node-telegram-bot-api";
import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { canOpenLibrary } from "../../services/library/access.js";
import { LIBRARY_WEBAPP_URL } from "../../constants/webapp.js";

/**
 * /library — the study material for the student's own subjects.
 *
 * The app is served from our own host, not from a static page, because the
 * session cookie that keeps a student signed in has to be first-party. It
 * only works for registered students; the app itself says so.
 *
 * Until the shelf is filled only the admin can open it; anyone else gets a
 * plain line in private, and nothing at all in a group.
 */
/**
 * The library entry, shared by /library and by the channel post's deep link
 * (`https://t.me/NbkristQik_bot?start=library`), so the button lands the
 * student on the same one-tap open.
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
  const text = "Your subjects, ready to read.";

  bot.sendMessage(msg.chat.id, text, {
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
