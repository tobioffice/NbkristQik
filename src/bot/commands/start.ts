import { bot } from "../bot.js";
import type { Message } from "node-telegram-bot-api";
import { trackMessage } from "../../services/tracker.js";
import { sendLibraryEntry } from "./library.js";
import { attendanceRoll, startPayload } from "./startPayload.js";
import { escapeHtml } from "../../services/text.js";
import { sendAttendanceOrMidMarks } from "../academics/studentActions.js";
import { takeGroupPrompts } from "../academics/groupPrompt.js";
import { isAuthorizedUser, rememberStudent } from "../authorization.js";
import {
  botSecurityHandler,
  isValidRollNumber,
  normalizeRollNumber,
} from "../../middleware/security.js";
import { logger } from "../../config/logger.js";
import { TOO_FAST, SOMETHING_BROKE } from "../replies.js";

const sendWelcome = async (msg: Message): Promise<void> => {
  const first = msg.from?.first_name?.trim();
  const greeting = first ? `Hi ${escapeHtml(first)}, welcome in` : `Welcome in`;

  const message =
    `${greeting}. I keep the NBKRIST attendance register here.\n` +
    `\n` +
    `Send me a roll number like <code>23KB1A0599</code> and I'll pull your attendance and mid marks from the college portal.\n` +
    `\n` +
    `Save yours once with /register and /attendance answers in one tap. /help covers the rest.`;

  await bot.sendMessage(msg.chat.id, message, { parse_mode: "HTML" });
};

/**
 * The group prompt that led here is spent: the student is in the bot now.
 * Telegram only deletes its own messages, so the student's roll message in
 * the group is left alone.
 *
 * Deliberately not awaited: a slow delete must never hold the card back, and
 * every failure (already gone, no permission, stale id) is just noise.
 */
const clearGroupPrompts = (userId: number, rollNumber: string): void => {
  for (const { chatId, messageId } of takeGroupPrompts(userId, rollNumber)) {
    void bot.deleteMessage(chatId, messageId).catch((e: unknown) => {
      logger.debug(
        "[start] group prompt could not be deleted:",
        e instanceof Error ? e.message : e,
      );
    });
  }
};

/**
 * `?start=att_<roll>`: the private half of the group's link.
 *
 * The group tap writes no lookup: this request is the lookup, so it carries
 * the same validation, rate limit and channel gate as a typed roll, and then
 * answers here in the DM. The leaderboard identity is registration, not the
 * last lookup, so no roll-to-user mapping is written.
 */
const answerDeepLinkRoll = async (
  msg: Message,
  rawRoll: string,
): Promise<void> => {
  const userId = msg.from?.id;
  if (!userId) return;

  // letter O never appears in real rolls, so a payload O is a zero
  const typed = rawRoll.trim().toUpperCase();
  const rollNumber = normalizeRollNumber(typed);

  // A stale or mistyped link is a plain /start, never an error.
  if (!isValidRollNumber(rollNumber)) {
    await sendWelcome(msg);
    return;
  }

  // the student acted on the group's button, so clean the room up first: the
  // prompt should not linger whatever this lookup then answers
  clearGroupPrompts(userId, rollNumber);

  if (!(await botSecurityHandler(userId, "start_attendance"))) {
    await bot.sendMessage(msg.chat.id, TOO_FAST);
    return;
  }

  const authorized = await isAuthorizedUser({ userId, chatId: msg.chat.id });
  if (!authorized) return;
  await rememberStudent(userId);

  trackMessage(msg, "roll_lookup", rollNumber);

  await sendAttendanceOrMidMarks(msg, rollNumber, "att", {
    replyToMessageId: msg.message_id,
    notice:
      rollNumber !== typed
        ? `Heads up, I read that O as 0, showing <code>${rollNumber}</code>.`
        : undefined,
  });
};

bot.onText(/^\/start/, (msg) => {
  trackMessage(msg, "command:start");

  const payload = startPayload(msg.text ?? "");

  // the channel's "Open the library" button is a deep link with this
  // payload: the student lands on the same one-tap library entry. Any other
  // payload falls through to the welcome.
  if (payload?.toLowerCase() === "library") {
    void sendLibraryEntry(msg).catch((e) =>
      logger.error("[start] library entry failed:", e),
    );
    return;
  }

  const roll = attendanceRoll(payload);
  // The group reply links here, in private. A `/start att_...` typed in a
  // group must never answer with the card, so it reads as a plain welcome.
  if (roll !== null && msg.chat.type === "private") {
    return answerDeepLinkRoll(msg, roll).catch((e: unknown) => {
      logger.error("[start] attendance deep link failed:", e);
      return bot
        .sendMessage(msg.chat.id, SOMETHING_BROKE)
        .catch(() => undefined);
    });
  }

  return sendWelcome(msg);
});
