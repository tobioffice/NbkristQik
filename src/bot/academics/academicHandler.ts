import { bot } from "../bot.js";
import type { CallbackQuery, Message } from "node-telegram-bot-api";

import { sendAttendanceOrMidMarks, sendBunkPlan } from "./studentActions.js";
import { cardMarkup } from "./cardMarkup.js";
import { rememberGroupPrompt } from "./groupPrompt.js";
import { getStudentCached } from "../../services/redis/utils.js";
import { upsertTgUser } from "../../db/student.model.js";
import {
  getRegistration,
  upsertRegistration,
  RollAlreadyRegisteredError,
} from "../../db/registration.model.js";
import { invalidateStudentContext } from "../../services/library/entitlement.js";

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
import { BOT_USERNAME, botLink } from "../../constants/telegram.js";

/** The same copy the web form shows when a roll belongs to another account. */
const ROLL_TAKEN_COPY =
  "This roll number is already saved to another Telegram account. " +
  "If it's yours, open the app from that account or ask the admin for help.";

const SAVE_PREFIX = "save_";

/** What a tapped card button needs to replace the card in place. */
interface ActionContext {
  /** The message carrying the card; the answer replaces it. */
  editMessageId: number;
  /** The student who tapped; the card's Save button depends on their roll. */
  userId: number;
}

/**
 * What a tapped button asks for.
 *
 * The callback data is `<prefix><roll>` (att_23CS1042). One table, so the
 * activity tracker and the handler cannot drift apart: a new lookup button is
 * a new row here and nothing else. Save is handled separately because it
 * writes instead of fetching a card.
 */
interface CallbackAction {
  prefix: string;
  /** The activity this button records. */
  tracked: string;
  run: (
    msg: Message,
    rollNumber: string,
    context: ActionContext,
  ) => Promise<void>;
}

const CALLBACK_ACTIONS: CallbackAction[] = [
  {
    prefix: "att_",
    tracked: "attendance",
    run: (msg, rollNumber, context) =>
      sendAttendanceOrMidMarks(msg, rollNumber, "att", {
        editMessageId: context.editMessageId,
        userId: context.userId,
      }),
  },
  {
    prefix: "mid_",
    tracked: "midmarks",
    run: (msg, rollNumber, context) =>
      sendAttendanceOrMidMarks(msg, rollNumber, "mid", {
        editMessageId: context.editMessageId,
        userId: context.userId,
      }),
  },
  {
    prefix: "bunk_",
    tracked: "bunk",
    run: (msg, rollNumber, context) =>
      sendBunkPlan(msg, rollNumber, {
        editMessageId: context.editMessageId,
        userId: context.userId,
      }),
  },
];

const actionFor = (data: string): CallbackAction | undefined =>
  CALLBACK_ACTIONS.find((action) => data.startsWith(action.prefix));

// persist userId→roll for "You are #N" in the leaderboard web app
// (best-effort — never block the card on it)
const persistRollMapping = (userId: number, rollNumber: string): void => {
  void getStudentCached(rollNumber)
    .then((student) => upsertTgUser(String(userId), student))
    .catch((e) => logger.debug("tg user upsert skipped:", e?.message ?? e));
};

/** The one line a group gets: where to go, never what the roll says. */
const ATTENDANCE_IS_PRIVATE =
  "Your attendance is private. Tap to open it in the bot.";

/**
 * A group is a shared room, so it gets the way into the bot and nothing else.
 * The roll rides in the button's deep link, not in the visible text; the card
 * itself waits in private.
 */
const sendPrivateAttendanceLink = async (
  msg: Message,
  rollNumber: string,
): Promise<void> => {
  const prompt = await bot.sendMessage(msg.chat.id, ATTENDANCE_IS_PRIVATE, {
    reply_to_message_id: msg.message_id,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Open attendance", url: botLink(`att_${rollNumber}`) }],
      ],
    },
  });

  // the prompt exists only to carry the student into the bot; park it and
  // the roll it answers so the private `/start` can clear both from the room
  if (msg.from && typeof prompt?.message_id === "number") {
    rememberGroupPrompt(msg.from.id, rollNumber, {
      chatId: msg.chat.id,
      messageId: prompt.message_id,
      sourceMessageId: msg.message_id,
    });
  }
};

const handleRollNumberMessage = async (msg: Message): Promise<void> => {
  const chatId = msg.chat.id;
  const from = msg.from;
  if (!from || !msg.text) return;
  // channels are broadcast: no lookups, no cards, nothing posted back
  if (msg.chat.type === "channel") return;
  const userId = from.id;
  const rawRoll = msg.text.trim().toUpperCase();
  // letter O never appears in real rolls, so a typed O is always a zero
  const rollNumber = normalizeRollNumber(rawRoll);
  const corrected = rollNumber !== rawRoll;

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
    // the join prompt is a DM with the student, even for a group roll
    joinPromptChatId: userId,
  });
  if (!authorized) return;
  await rememberStudent(userId);

  // A group or supergroup is a shared room: the card would show the student's
  // attendance, marks and below-75% warning to everyone. The room gets a
  // deep link instead; the lookup itself happens in private.
  if (msg.chat.type !== "private") {
    await sendPrivateAttendanceLink(msg, rollNumber);
    return;
  }

  // only an authorized lookup may say who "you" are: a blocked or invalid
  // roll must not move the leaderboard identity
  persistRollMapping(userId, rollNumber);

  trackActivity({
    userId,
    username: from.username,
    firstName: from.first_name,
    chatType: msg.chat.type as ChatSurface,
    action: "roll_lookup",
    detail: rollNumber,
  });

  // No menu: the roll is a request for attendance, so answer it with the
  // attendance card, replying to the student's own message. The card carries
  // every other action.
  await sendAttendanceOrMidMarks(msg, rollNumber, "att", {
    replyToMessageId: msg.message_id,
    notice: corrected
      ? `Heads up, I read that O as 0, showing <code>${rollNumber}</code>.`
      : undefined,
  });
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

/**
 * `save_<roll>`: pin the roll to this Telegram account.
 *
 * The toast is the result. A roll held by another account gets the same copy
 * as the web form and never reveals which account holds it.
 */
const handleSaveRoll = async (
  callbackQuery: CallbackQuery,
  msg: Message,
): Promise<void> => {
  const data = callbackQuery.data ?? "";
  const rollNumber = data.slice(SAVE_PREFIX.length);
  const userId =
    callbackQuery.from?.id ??
    (msg.chat.type === "private" ? msg.chat.id : undefined);
  const answer = (text: string) =>
    bot.answerCallbackQuery(callbackQuery.id, { text }).catch(() => {});

  if (userId === undefined) {
    await answer(SOMETHING_BROKE);
    return;
  }
  if (!isValidRollNumber(rollNumber)) {
    await answer(BAD_ROLL);
    return;
  }

  let saved = false;
  try {
    const existing = await getRegistration(String(userId));
    if (existing?.roll_no.toUpperCase() === rollNumber.toUpperCase()) {
      await answer("Saved already");
      saved = true;
    } else {
      await upsertRegistration(String(userId), rollNumber, null);
      invalidateStudentContext(String(userId));
      await answer("Saved. /attendance answers in one tap now.");
      saved = true;
    }
  } catch (e: unknown) {
    if (e instanceof RollAlreadyRegisteredError) {
      await answer(ROLL_TAKEN_COPY);
    } else {
      logger.error("[academicHandler] save roll failed:", e);
      await answer(SOMETHING_BROKE);
    }
  }

  if (!saved) return;

  // The card stays on screen; only the Save button goes away.
  await bot
    .editMessageReplyMarkup(
      cardMarkup({
        roll: rollNumber,
        isPrivate: msg.chat.type === "private",
        showSave: false,
      }),
      { chat_id: msg.chat.id, message_id: msg.message_id },
    )
    .catch((e: Error) =>
      logger.debug(
        "[academicHandler] save button hide skipped:",
        e?.message ?? e,
      ),
    );
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
  });
  if (!authorized) {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: "Join the channel first, then try again.",
      show_alert: true,
    });
    return;
  }

  if (data.startsWith(SAVE_PREFIX)) {
    if (callbackQuery.from) {
      trackActivity({
        userId: callbackQuery.from.id,
        username: callbackQuery.from.username,
        firstName: callbackQuery.from.first_name,
        chatType: msg.chat.type as ChatSurface,
        action: "save",
        detail: data.slice(SAVE_PREFIX.length),
      });
    }
    await handleSaveRoll(callbackQuery, msg);
    return;
  }

  // the tapped button tells us what they wanted; in channels msg.from is
  // the channel itself, so the actor is always callbackQuery.from
  const action = actionFor(data);
  if (!action) {
    await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
    return;
  }

  const rollNumber = data.slice(action.prefix.length);
  if (callbackQuery.from) {
    trackActivity({
      userId: callbackQuery.from.id,
      username: callbackQuery.from.username,
      firstName: callbackQuery.from.first_name,
      chatType: msg.chat.type as ChatSurface,
      action: action.tracked,
      detail: rollNumber,
    });
  }

  // A mutated or stale callback is rejected before any portal request.
  if (!isValidRollNumber(rollNumber)) {
    await bot
      .answerCallbackQuery(callbackQuery.id, {
        text: BAD_ROLL,
        show_alert: true,
      })
      .catch(() => {});
    return;
  }

  // The card is edited in place, never deleted: the action surface must stay
  // on screen. Answering first stops the button's spinner.
  const results = await Promise.allSettled([
    bot.answerCallbackQuery(callbackQuery.id),
    action.run(msg, rollNumber, {
      editMessageId: msg.message_id,
      userId,
    }),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn("[academicHandler] callback step failed:", result.reason);
    }
  }
};
