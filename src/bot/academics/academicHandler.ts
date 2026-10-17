import { bot } from "../bot.js";
import type { CallbackQuery, Message } from "node-telegram-bot-api";

import {
  sendAttendanceOrMidMarks,
  sendJoinChannelMsg,
  sendBunkPlan,
} from "./studentActions.js";
import { checkMembership } from "../../services/student.utils/checkMembership.js";
import { getClient } from "../../services/redis/getRedisClient.js";
import { redisKeys } from "../../services/redis/keys.js";
import { getStudentCached } from "../../services/redis/utils.js";
import { upsertTgUser } from "../../db/student.model.js";

import {
  ROLL_REGEX,
  PROTECTED_CHAT_ID,
  CHIT_CHAT_ID,
} from "../../constants/index.js";
import {
  botSecurityHandler,
  isValidRollNumber,
  normalizeRollNumber,
} from "../../middleware/security.js";
import { ADMIN_ID } from "../../config/environmentals.js";
import { logger } from "../../config/logger.js";
import { trackActivity, ChatSurface } from "../../services/tracker.js";
import { checkGroupUse } from "../groupLimit.js";
import { WEBAPP_URL } from "../../constants/webapp.js";

const getCachedMembership = async (userId: number): Promise<boolean> => {
  try {
    const redisClient = await getClient();
    return (await redisClient.get(redisKeys.isMember(userId))) === "true";
  } catch (e) {
    // Redis down must not break authorization — fall through to the live check
    logger.warn("[academicHandler] membership cache read failed:", e);
    return false;
  }
};

const isAuthorizedUser = async (
  userId: number,
  chatId: number,
): Promise<boolean> => {
  // admin always allowed
  if (userId === ADMIN_ID) return true;

  let isMember = await getCachedMembership(userId);
  if (!isMember) {
    try {
      isMember = await checkMembership(userId);
    } catch (e) {
      logger.warn("[academicHandler] membership check failed:", e);
      // cannot verify membership right now — let the request through rather
      // than locking out members
      isMember = true;
    }
  }

  if (!isMember && !(chatId === PROTECTED_CHAT_ID)) {
    await sendJoinChannelMsg(userId);
    return false;
  }

  // track user for broadcasts (best-effort, never block)
  try {
    const redisClient = await getClient();
    await redisClient.sAdd(redisKeys.broadcastUsers, String(userId));
  } catch (e) {
    logger.error("user tracking failed:", e);
  }
  return true;
};

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

  // Check rate limit first
  const rateLimitAllowed = await botSecurityHandler(userId, "roll_number");
  if (!rateLimitAllowed) {
    await bot.sendMessage(chatId, "Too fast for me. Try again in a minute.");
    return;
  }

  // Validate roll number format
  if (!isValidRollNumber(rollNumber)) {
    await bot.sendMessage(
      chatId,
      "That roll number doesn't look right. Check it and send it again.",
    );
    return;
  }

  const authorized = await isAuthorizedUser(userId, chatId);
  if (!authorized) return;

  // group chats get 2 lifetime answers; past that, point the user to DM
  if (!(await checkGroupUse(userId, chatId, msg.message_id, msg.chat.type)))
    return;

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
      "I can't check rolls in this group. Tap @NbkristQik_bot and send it there.",
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
    bot
      .sendMessage(
        msg.chat.id,
        "Something broke on my side. Try again in a bit.",
      )
      .catch(() => {});
  });
});

//HANDLE CALLBACK QUERY
// chit chat group: bot never responds there
const handleChitChatCallback = async (callbackQueryId: string) => {
  await bot
    .answerCallbackQuery(callbackQueryId, {
      text: "I don't reply in this group. Message @NbkristQik_bot instead",
      show_alert: true,
    })
    .catch(() => {});
};

bot.on("callback_query", async (callbackQuery) => {
  try {
    await handleCallbackQuery(callbackQuery);
  } catch (e) {
    logger.error("[academicHandler] callback failed:", e);
    bot
      .answerCallbackQuery(callbackQuery.id, {
        text: "Something broke on my side. Try again in a bit.",
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

  // Check rate limit for callback queries
  const rateLimitAllowed = await botSecurityHandler(userId, "callback");
  if (!rateLimitAllowed) {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: "Too fast for me. Try again in a minute.",
      show_alert: true,
    });
    return;
  }

  const authorized = await isAuthorizedUser(userId, msg.chat.id);
  if (!authorized) {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: "Join the channel first, then try again.",
      show_alert: true,
    });
    return;
  }

  // same group gate as the message flow; the redirect goes to the group,
  // so just dismiss the spinner here
  if (
    !(await checkGroupUse(userId, msg.chat.id, msg.message_id, msg.chat.type))
  ) {
    await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
    return;
  }

  // the tapped button tells us what they wanted; in channels msg.from is
  // the channel itself, so the actor is always callbackQuery.from
  const callbackAction = data.startsWith("att_")
    ? "attendance"
    : data.startsWith("mid_")
      ? "midmarks"
      : data.startsWith("bunk_")
        ? "bunk"
        : null;
  if (callbackAction && callbackQuery.from) {
    trackActivity({
      userId: callbackQuery.from.id,
      username: callbackQuery.from.username,
      firstName: callbackQuery.from.first_name,
      chatType: msg.chat.type as ChatSurface,
      action: callbackAction,
      detail: data.slice(data.indexOf("_") + 1),
    });
  }

  const results = await Promise.allSettled([
    bot.deleteMessage(msg.chat.id, msg.message_id),
    handleCallbackAction(data, msg),
    bot.answerCallbackQuery(callbackQuery.id),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn("[academicHandler] callback step failed:", result.reason);
    }
  }
};

const handleCallbackAction = async (data: string, msg: Message) => {
  if (data.startsWith("att_")) {
    const rollNumber = data.slice(4); // More efficient than split
    if (!isValidRollNumber(rollNumber)) {
      await bot.sendMessage(
        msg.chat.id,
        "That roll number doesn't look right. Check it and send it again.",
      );
      return;
    }
    await sendAttendanceOrMidMarks(msg, rollNumber, "att");
  } else if (data.startsWith("mid_")) {
    const rollNumber = data.slice(4);
    if (!isValidRollNumber(rollNumber)) {
      await bot.sendMessage(
        msg.chat.id,
        "That roll number doesn't look right. Check it and send it again.",
      );
      return;
    }
    await sendAttendanceOrMidMarks(msg, rollNumber, "mid");
  } else if (data.startsWith("bunk_")) {
    const rollNumber = data.slice(5);
    if (!isValidRollNumber(rollNumber)) {
      await bot.sendMessage(
        msg.chat.id,
        "That roll number doesn't look right. Check it and send it again.",
      );
      return;
    }
    await sendBunkPlan(msg, rollNumber);
  }
};
