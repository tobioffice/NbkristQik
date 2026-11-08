import type { InlineKeyboardButton, Message } from "node-telegram-bot-api";
import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";
import { canOpenLibrary } from "../../services/library/access.js";
import { createPcLoginToken } from "../../services/library/session.js";
import { LIBRARY_WEBAPP_URL } from "../../constants/webapp.js";
import { logger } from "../../config/logger.js";
import { botSecurityHandler } from "../../middleware/security.js";
import { TOO_FAST } from "../replies.js";

/**
 * The library entry, shared by /library and by the channel post's deep link
 * (`https://t.me/NbkristQik_bot?start=library`), so the button lands the
 * student on the same one-tap open.
 *
 * In private the message also carries a one-shot link that signs a PC browser
 * in: the mini app only opens inside Telegram, and a laptop is where a PDF is
 * actually read. The link is minted per message and expires in five minutes;
 * groups never get it, because the token belongs to the sender and a group
 * would hand it to everyone.
 *
 * The link opens the library section of the app. Until the shelf is filled
 * only the admin can open it; anyone else gets a plain line in private, and
 * nothing at all in a group.
 */

/** `?pc=<token>` goes before the hash route, where the app can read it. */
const pcLoginUrl = (token: string): string => {
  const [base, hash] = LIBRARY_WEBAPP_URL.split("#");
  const query = `${base}${base.includes("?") ? "&" : "?"}pc=${encodeURIComponent(token)}`;
  return hash ? `${query}#${hash}` : query;
};

export const sendLibraryEntry = async (msg: Message): Promise<void> => {
  const from = msg.from?.id;
  if (!from) return;

  // Minting a computer link writes an Redis token; a user hammering /library
  // must not turn that into a write loop.
  if (!(await botSecurityHandler(from, "library"))) {
    if (msg.chat.type === "private") {
      await bot.sendMessage(msg.chat.id, TOO_FAST);
    }
    return;
  }

  if (!canOpenLibrary(from)) {
    if (msg.chat.type === "private") {
      await bot.sendMessage(msg.chat.id, "The library isn't open yet.");
    }
    return;
  }

  const isPrivate = msg.chat.type === "private";
  const keyboard: InlineKeyboardButton[][] = [
    [
      isPrivate
        ? { text: "Open the library", web_app: { url: LIBRARY_WEBAPP_URL } }
        : { text: "Open the library", url: LIBRARY_WEBAPP_URL },
    ],
  ];

  let computerLink = false;
  if (isPrivate) {
    try {
      const token = await createPcLoginToken(String(from));
      keyboard.push([
        { text: "Open on this computer", url: pcLoginUrl(token) },
      ]);
      computerLink = true;
    } catch (e) {
      // Redis is a convenience here, not the entry itself: send the normal
      // button and let the student read in Telegram.
      logger.warn("[library] could not mint a computer link:", e);
    }
  }

  await bot.sendMessage(
    msg.chat.id,
    computerLink
      ? "Your subjects, ready to read. The computer link is for you, works once, and expires in five minutes."
      : "Your subjects, ready to read.",
    { reply_markup: { inline_keyboard: keyboard } },
  );
};

bot.onText(/^\/library$/, (msg) => {
  trackMessage(msg, "command:library");
  void sendLibraryEntry(msg).catch((e) =>
    logger.error("[library] could not send the entry:", e),
  );
});
