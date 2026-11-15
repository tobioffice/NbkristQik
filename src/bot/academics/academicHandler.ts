import { bot } from "../bot.js";
import type { Context, Message } from "node-telegram-bot-api";

import { sendAttendanceOrMidMarks, sendBunkPlan } from "./studentActions.js";
import { cardMarkup, withTextCard } from "./cardMarkup.js";
import { LEADERBOARD_TEXT, leaderboardMarkup } from "../leaderboardRedirect.js";
import { sendPrivateCardLink } from "./groupLink.js";
import { widgetKind } from "../../services/student.utils/widget.js";
import { getStudentCached } from "../../services/redis/utils.js";
import { upsertTgUser } from "../../db/student.model.js";
import {
  getRegistration,
  upsertRegistration,
} from "../../db/registration.model.js";
import { invalidateStudentContext } from "../../services/library/entitlement.js";
import { isRegistrationBlockedFor } from "../../services/verification/otp.js";

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
import { BOT_USERNAME } from "../../constants/telegram.js";
import { handleGameCallback, isGameCallback } from "../../games/handler.js";

const SAVE_PREFIX = "save_";
const TEXT_PREFIX = "text_";

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

// persist userId→roll for the register's "you" row
// (best-effort — never block the card on it)
const persistRollMapping = (userId: number, rollNumber: string): void => {
  void getStudentCached(rollNumber)
    .then((student) => upsertTgUser(String(userId), student))
    .catch((e) => logger.debug("tg user upsert skipped:", e?.message ?? e));
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
    await bot.api.sendMessage({ chat_id: chatId, text: TOO_FAST });
    return;
  }

  if (!isValidRollNumber(rollNumber)) {
    await bot.api.sendMessage({ chat_id: chatId, text: BAD_ROLL });
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
    await sendPrivateCardLink(msg, rollNumber, "att");
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
  bot.api
    .deleteMessage({ chat_id: msg.chat.id, message_id: msg.message_id })
    .catch(() => {});
  bot.api
    .sendMessage({
      chat_id: msg.chat.id,
      text: `I can't check rolls in this group. Tap @${BOT_USERNAME} and send it there.`,
      disable_notification: true,
    })
    .then((notice: Message) => {
      setTimeout(() => {
        bot.api
          .deleteMessage({
            chat_id: msg.chat.id,
            message_id: notice.message_id,
          })
          .catch(() => {});
      }, 15000);
    })
    .catch(() => {});
};

bot.hears(ROLL_REGEX, (ctx) => {
  const msg = ctx.message;
  if (!msg) return;

  if (msg.chat.id === CHIT_CHAT_ID) {
    handleChitChatRoll(msg);
    return;
  }
  return handleRollNumberMessage(msg).catch((e) => {
    logger.error("[academicHandler] roll message failed:", e);
    bot.api
      .sendMessage({ chat_id: msg.chat.id, text: SOMETHING_BROKE })
      .catch(() => {});
  });
});

// HANDLE CALLBACK QUERY
// chit chat group: bot never responds there
const handleChitChatCallback = async (ctx: Context): Promise<void> => {
  await ctx
    .answerCallbackQuery({
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
const handleSaveRoll = async (ctx: Context, msg: Message): Promise<void> => {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery) return;

  const data = callbackQuery.data ?? "";
  const rollNumber = data.slice(SAVE_PREFIX.length);
  const userId =
    callbackQuery.from?.id ??
    (msg.chat.type === "private" ? msg.chat.id : undefined);
  const answer = (text: string) =>
    ctx.answerCallbackQuery({ text }).catch(() => undefined);

  if (userId === undefined) {
    await answer(SOMETHING_BROKE);
    return;
  }
  if (!isValidRollNumber(rollNumber)) {
    await answer(BAD_ROLL);
    return;
  }
  if (await isRegistrationBlockedFor(rollNumber, String(userId))) {
    await answer("That roll is verified by another student.");
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
    logger.error("[academicHandler] save roll failed:", e);
    await answer(SOMETHING_BROKE);
  }

  if (!saved) return;

  // The card stays on screen; only the Save button goes away.
  const markup = cardMarkup({
    roll: rollNumber,
    showSave: false,
    isPrivate: msg.chat.type === "private",
  });
  await bot.api
    .editMessageReplyMarkup({
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup:
        "widget" in msg && msg.widget
          ? withTextCard(markup, rollNumber)
          : markup,
    })
    .catch((e: Error) =>
      logger.debug(
        "[academicHandler] save button hide skipped:",
        e?.message ?? e,
      ),
    );
};

bot.on("callback_query", async (ctx) => {
  try {
    await handleCallbackQuery(ctx);
  } catch (e) {
    logger.error("[academicHandler] callback failed:", e);
    ctx
      .answerCallbackQuery({ text: SOMETHING_BROKE, show_alert: true })
      .catch(() => {});
  }
});

const handleCallbackQuery = async (ctx: Context): Promise<void> => {
  const callbackQuery = ctx.callbackQuery;
  const msg = callbackQuery?.message;

  if (!callbackQuery || !msg) return;

  // channel taps: dismiss the spinner, serve nothing (broadcast, not a chat)
  if (msg.chat.type === "channel") {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  if (msg.chat.id === CHIT_CHAT_ID) {
    await handleChitChatCallback(ctx);
    return;
  }

  const userId = callbackQuery.from?.id || msg.chat.id;

  if (!(await botSecurityHandler(userId, "callback"))) {
    await ctx.answerCallbackQuery({ text: TOO_FAST, show_alert: true });
    return;
  }

  const authorized = await isAuthorizedUser({
    userId,
    chatId: msg.chat.id,
  });
  if (!authorized) {
    await ctx.answerCallbackQuery({
      text: "Join the channel first, then try again.",
      show_alert: true,
    });
    return;
  }

  const data = callbackQuery.data ?? "";

  // League cards own their prefixes and their own privacy guard. The
  // dispatcher has already paid the rate limit and the channel gate.
  if (isGameCallback(data)) {
    await handleGameCallback(ctx);
    return;
  }

  // Any card that somehow landed in a group must not be re-rendered in front
  // of the room. The register is the one public answer.
  if (msg.chat.type !== "private" && data !== "lb") {
    await ctx
      .answerCallbackQuery({
        text: "That card is private now. Send /attendance here and I'll take you to the bot.",
        show_alert: true,
      })
      .catch(() => {});
    return;
  }

  // The widget's escape hatch: send the same card as a normal message for a
  // client that cannot render widgets, or for a reader who prefers text.
  if (data.startsWith(TEXT_PREFIX) && "widget" in msg) {
    const roll = data.slice(TEXT_PREFIX.length);
    if (!isValidRollNumber(roll)) {
      await ctx
        .answerCallbackQuery({ text: BAD_ROLL, show_alert: true })
        .catch(() => {});
      return;
    }

    const kind = widgetKind(msg.widget?.chat_data);
    await ctx.answerCallbackQuery({ text: "Text card sent" }).catch(() => {});
    const options = {
      userId,
      replyToMessageId: msg.message_id,
      forceText: true,
    };

    if (kind === "bunk") {
      await sendBunkPlan(msg, roll, options);
    } else {
      await sendAttendanceOrMidMarks(
        msg,
        roll,
        kind === "mid" ? "mid" : "att",
        options,
      );
    }
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
    await handleSaveRoll(ctx, msg);
    return;
  }

  // Legacy Leaderboard buttons on cards already in the chat. The register is
  // a page now; no top-ten list is printed in the room.
  if (data === "lb") {
    await ctx.answerCallbackQuery().catch(() => {});
    await bot.api
      .sendMessage({
        chat_id: msg.chat.id,
        text: LEADERBOARD_TEXT,
        parse_mode: "HTML",
        reply_markup: leaderboardMarkup(msg.chat.type === "private"),
        reply_parameters: { message_id: msg.message_id },
      })
      .catch((e: Error) =>
        logger.warn(
          "[academicHandler] register redirect failed:",
          e?.message ?? e,
        ),
      );
    return;
  }

  // the tapped button tells us what they wanted; in channels msg.from is
  // the channel itself, so the actor is always callbackQuery.from
  const action = actionFor(data);
  if (!action) {
    await ctx.answerCallbackQuery().catch(() => {});
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
    await ctx
      .answerCallbackQuery({ text: BAD_ROLL, show_alert: true })
      .catch(() => {});
    return;
  }

  // The card is edited in place, never deleted: the action surface must stay
  // on screen. Answering first stops the button's spinner.
  const results = await Promise.allSettled([
    ctx.answerCallbackQuery(),
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
