import { bot } from "../bot.js";
import type { CallbackQuery, Message } from "node-telegram-bot-api";

import { sendAttendanceOrMidMarks, sendBunkPlan } from "./studentActions.js";
import { getStudentCached } from "../../services/redis/utils.js";
import { upsertTgUser } from "../../db/student.model.js";

import { ROLL_REGEX, CHIT_CHAT_ID } from "../../constants/index.js";
import {
  botSecurityHandler,
  isValidRollNumber,
  normalizeRollNumber,
} from "../../middleware/security.js";
import { logger } from "../../config/logger.js";
import { trackActivity, ChatSurface } from "../../services/tracker.js";
import { isAuthorizedUser, rememberStudent } from "../authorization.js";
import { TOO_FAST, SOMETHING_BROKE, BAD_ROLL } from "../replies.js";
import { WEBAPP_URL } from "../../constants/webapp.js";
import { BOT_USERNAME } from "../../constants/telegram.js";

/**
 * What a tapped button asks for.
 *
 * The callback data is `<prefix><roll>` (att_23CS1042). One table, so the
 * activity tracker and the handler cannot drift apart: a new button is a new
 * row here and nothing else.
 */
interface CallbackAction {
  prefix: string;
  /** The activity this button records. */
  tracked: string;
  run: (msg: Message, rollNumber: string) => Promise<void>;
}

const CALLBACK_ACTIONS: CallbackAction[] = [
  {
    prefix: "att_",
    tracked: "attendance",
    run: (msg, rollNumber) => sendAttendanceOrMidMarks(msg, rollNumber, "att"),
  },
  {
    prefix: "mid_",
    tracked: "midmarks",
    run: (msg, rollNumber) => sendAttendanceOrMidMarks(msg, rollNumber, "mid"),
  },
  {
    prefix: "bunk_",
    tracked: "bunk",
    run: (msg, rollNumber) => sendBunkPlan(msg, rollNumber),
  },
];

const actionFor = (data: string): CallbackAction | undefined =>
  CALLBACK_ACTIONS.find((action) => data.startsWith(action.prefix));

// persist userId→roll for "You are #N" in the leaderboard web app
// (best-effort — never block the menu on it)
const persistRollMapping = (userId: number, rollNumber: string): void => {
  void getStudentCached(rollNumber)
    .then((student) => upsertTgUser(String(userId), student))
    .catch((e) => logger.debug("tg user upsert skipped:", e?.message ?? e));
};

const sendRollOptions = (
  chatId: number,
  rollNumber: string,
  replyToMessageId: number,
  isPrivate: boolean,
  notice?: string,
) =>
  bot.sendMessage(
    chatId,
    `${notice ? `${notice}\n\n` : ""}What do you want to check?`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Attendance 🚀", callback_data: `att_${rollNumber}` }],
          [{ text: "Mid Marks 📊", callback_data: `mid_${rollNumber}` }],
          [{ text: "Bunk Plan 🎯", callback_data: `bunk_${rollNumber}` }],
          [
            // web_app buttons are private-only; groups get a plain link
            isPrivate
              ? { text: "Leaderboard 🏆", web_app: { url: WEBAPP_URL } }
              : { text: "Leaderboard 🏆", url: WEBAPP_URL },
          ],
        ],
      },
      reply_to_message_id: replyToMessageId,
    },
  );

const handleRollNumberMessage = async (msg: Message): Promise<void> => {
  const chatId = msg.chat.id;
  const from = msg.from;
  if (!from || !msg.text) return;
  // channels are broadcast: no lookups, no menus, nothing posted back
  if (msg.chat.type === "channel") return;
  const userId = from.id;
  const rawRoll = msg.text.trim().toUpperCase();
  // letter O never appears in real rolls, so a typed O is always a zero
  const rollNumber = normalizeRollNumber(rawRoll);
  const corrected = rollNumber !== rawRoll;

  persistRollMapping(userId, rollNumber);

  if (!(await botSecurityHandler(userId, "roll_number"))) {
    await bot.sendMessage(chatId, TOO_FAST);
    return;
  }

  if (!isValidRollNumber(rollNumber)) {
    await bot.sendMessage(chatId, BAD_ROLL);
    return;
  }

  const authorized = await isAuthorizedUser({
    userId,
    chatId,
    replyToMessageId: msg.message_id,
    // a group never sees this card: it only makes sense to one reader
    joinPromptChatId: userId,
  });
  if (!authorized) return;
  await rememberStudent(userId);

  trackActivity({
    userId,
    username: from.username,
    firstName: from.first_name,
    chatType: msg.chat.type as ChatSurface,
    action: "roll_lookup",
    detail: rollNumber,
  });

  await sendRollOptions(
    chatId,
    rollNumber,
    msg.message_id,
    msg.chat.type === "private",
    corrected
      ? `Heads up, I read that O as 0, showing <code>${rollNumber}</code>.`
      : undefined,
  );
};

// chit chat group: delete roll numbers, brief in-group notice that self-deletes
const handleChitChatRoll = (msg: Message) => {
  bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
  bot
    .sendMessage(
      msg.chat.id,
      `I can't check rolls in this group. Tap @${BOT_USERNAME} and send it there.`,
      { disable_notification: true },
    )
    .then((notice: Message) => {
      setTimeout(() => {
        bot.deleteMessage(msg.chat.id, notice.message_id).catch(() => {});
      }, 15000);
    })
    .catch(() => {});
};

bot.onText(ROLL_REGEX, (msg) => {
  if (msg.chat.id === CHIT_CHAT_ID) {
    handleChitChatRoll(msg);
    return;
  }
  handleRollNumberMessage(msg).catch((e) => {
    logger.error("[academicHandler] roll message failed:", e);
    bot.sendMessage(msg.chat.id, SOMETHING_BROKE).catch(() => {});
  });
});

//HANDLE CALLBACK QUERY
// chit chat group: bot never responds there
const handleChitChatCallback = async (callbackQueryId: string) => {
  await bot
    .answerCallbackQuery(callbackQueryId, {
      text: `I don't reply in this group. Message @${BOT_USERNAME} instead`,
      show_alert: true,
    })
    .catch(() => {});
};

/** Runs the tapped lookup, refusing a roll number that is not one. */
const runAction = async (
  action: CallbackAction,
  data: string,
  msg: Message,
): Promise<void> => {
  const rollNumber = data.slice(action.prefix.length);
  if (!isValidRollNumber(rollNumber)) {
    await bot.sendMessage(msg.chat.id, BAD_ROLL);
    return;
  }
  await action.run(msg, rollNumber);
};

bot.on("callback_query", async (callbackQuery) => {
  try {
    await handleCallbackQuery(callbackQuery);
  } catch (e) {
    logger.error("[academicHandler] callback failed:", e);
    bot
      .answerCallbackQuery(callbackQuery.id, {
        text: SOMETHING_BROKE,
        show_alert: true,
      })
      .catch(() => {});
  }
});

const handleCallbackQuery = async (
  callbackQuery: CallbackQuery,
): Promise<void> => {
  const { data = "", message: msg } = callbackQuery;

  if (!msg) return;

  // dailycheck is fully handled in dailyCheckIn.ts (would otherwise
  // rate-limit + try to delete the pinned channel post)
  if (data === "dailycheck") return;

  // channel taps: dismiss the spinner, serve nothing (broadcast, not a chat)
  if (msg.chat.type === "channel") {
    await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
    return;
  }

  if (msg.chat.id === CHIT_CHAT_ID) {
    await handleChitChatCallback(callbackQuery.id);
    return;
  }

  const userId = callbackQuery.from?.id || msg.chat.id;

  if (!(await botSecurityHandler(userId, "callback"))) {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: TOO_FAST,
      show_alert: true,
    });
    return;
  }

  const authorized = await isAuthorizedUser({
    userId,
    chatId: msg.chat.id,
    replyToMessageId: msg.message_id,
  });
  if (!authorized) {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: "Join the channel first, then try again.",
      show_alert: true,
    });
    return;
  }

  // the tapped button tells us what they wanted; in channels msg.from is
  // the channel itself, so the actor is always callbackQuery.from
  const action = actionFor(data);
  if (action && callbackQuery.from) {
    trackActivity({
      userId: callbackQuery.from.id,
      username: callbackQuery.from.username,
      firstName: callbackQuery.from.first_name,
      chatType: msg.chat.type as ChatSurface,
      action: action.tracked,
      detail: data.slice(action.prefix.length),
    });
  }

  const results = await Promise.allSettled([
    bot.deleteMessage(msg.chat.id, msg.message_id),
    action ? runAction(action, data, msg) : Promise.resolve(),
    bot.answerCallbackQuery(callbackQuery.id),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn("[academicHandler] callback step failed:", result.reason);
    }
  }
};
