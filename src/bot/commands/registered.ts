import { bot } from "../bot.js";
import type { Message } from "node-telegram-bot-api";

import {
  sendAttendanceOrMidMarks,
  sendBunkPlan,
} from "../academics/studentActions.js";
import { checkMembership } from "../../services/student.utils/checkMembership.js";
import { getClient } from "../../services/redis/getRedisClient.js";
import { redisKeys } from "../../services/redis/keys.js";
import { getRegistration } from "../../db/registration.model.js";
import {
  getStudentCached,
  StudentNotFoundError,
} from "../../services/redis/utils.js";
import { upsertTgUser } from "../../db/student.model.js";
import { PROTECTED_CHAT_ID, CHIT_CHAT_ID } from "../../constants/index.js";
import { botSecurityHandler } from "../../middleware/security.js";
import { ADMIN_ID, CHANNEL_ID } from "../../config/environmentals.js";
import { logger } from "../../config/logger.js";
import { trackMessage } from "../../services/tracker.js";
import { isDailyUnlocked, getCheckInLink } from "../dailyCheckIn.js";
import { REGISTER_WEBAPP_URL } from "../../constants/webapp.js";

const getCachedMembership = async (userId: number): Promise<boolean> => {
  try {
    const redisClient = await getClient();
    return (await redisClient.get(redisKeys.isMember(userId))) === "true";
  } catch (e) {
    logger.warn("[registered] membership cache read failed:", e);
    return false;
  }
};

/** Same gate as the roll-number flow so all entry points behave alike. */
const isAuthorizedUser = async (
  userId: number,
  chatId: number,
  replyToMessageId?: number,
): Promise<boolean> => {
  if (userId === ADMIN_ID) return true;

  let isMember = await getCachedMembership(userId);
  if (!isMember) {
    try {
      isMember = await checkMembership(userId);
    } catch (e) {
      logger.warn("[registered] membership check failed:", e);
      isMember = true;
    }
  }

  if (!isMember && !(chatId === PROTECTED_CHAT_ID)) {
    await sendJoinChannelMsg(chatId);
    return false;
  }

  if (!(await isDailyUnlocked(userId))) {
    const checkInLink = await getCheckInLink();
    const target = chatId < 0 ? chatId : userId;
    await bot.sendMessage(
      target,
      "🔓 <b>Quick human check</b>\n\nTap <b>\"I'm not a robot\"</b> below and you're in.",
      {
        parse_mode: "HTML",
        // show as a reply to the command message so it's clearly for them
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
        reply_markup: {
          inline_keyboard: [[{ text: "👇 I'm not a robot", url: checkInLink }]],
        },
      },
    );
    return false;
  }

  return true;
};

const sendJoinChannelMsg = async (chatId: number): Promise<void> => {
  const channelName = CHANNEL_ID.slice(1) || "NbkristQik_bot";
  await bot.sendMessage(
    chatId,
    "I need you in the channel first, then I can help you here.",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `Join @${channelName}`,
              url: `https://t.me/${channelName}`,
            },
          ],
        ],
      },
    },
  );
};

const REGISTER_BUTTON = {
  parse_mode: "HTML" as const,
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: "👤 Register your roll",
          web_app: { url: REGISTER_WEBAPP_URL },
        },
      ],
    ],
  },
};

const promptRegister = (chatId: number): void => {
  bot.sendMessage(
    chatId,
    `Save your roll number first, then this command answers instantly.`,
    REGISTER_BUTTON,
  );
};

/**
 * Resolve the caller's registered roll, or explain why not.
 * Returns the uppercase roll, or null after sending the right guidance.
 */
export const resolveRegisteredRoll = async (
  userId: number,
  chatId: number,
): Promise<string | null> => {
  const registration = await getRegistration(String(userId));
  if (!registration) {
    promptRegister(chatId);
    return null;
  }

  try {
    // also refresh the tgusers mapping so the leaderboard stays consistent
    const student = await getStudentCached(registration.roll_no);
    void upsertTgUser(String(userId), student).catch(() => {});
    return registration.roll_no;
  } catch (e) {
    if (e instanceof StudentNotFoundError) {
      // registered roll left studentsnew (semester sync) — ask for an update
      bot.sendMessage(
        chatId,
        `Your saved roll <code>${registration.roll_no}</code> isn't in the college records anymore.\n\n` +
          `If the semester changed, save your new roll and this command works again.`,
        REGISTER_BUTTON,
      );
      return null;
    }

    // Redis/DB hiccup, not a stale registration — don't tell the user their
    // roll was deleted.
    logger.warn("[registered] roll refresh failed:", e);
    bot
      .sendMessage(
        chatId,
        "Couldn't check your roll right now. Try again in a minute.",
      )
      .catch(() => {});
    return null;
  }
};

const handleRegisteredLookup = async (
  msg: Message,
  action: "att" | "mid" | "bunk",
): Promise<void> => {
  const chatId = msg.chat.id;
  const from = msg.from;
  if (!from) return;
  // channels are broadcast: instant commands serve nothing there
  if (msg.chat.type === "channel") return;

  if (chatId === CHIT_CHAT_ID) {
    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    return;
  }

  const rateLimitAllowed = await botSecurityHandler(from.id, "command");
  if (!rateLimitAllowed) {
    await bot.sendMessage(chatId, "Too fast for me. Try again in a minute.");
    return;
  }

  if (!(await isAuthorizedUser(from.id, chatId, msg.message_id))) return;

  trackMessage(
    msg,
    action === "att"
      ? "command:attendance"
      : action === "mid"
        ? "command:midmarks"
        : "command:bunk",
  );

  const rollNo = await resolveRegisteredRoll(from.id, chatId);
  if (!rollNo) return;

  if (action === "bunk") {
    await sendBunkPlan(msg, rollNo);
  } else {
    await sendAttendanceOrMidMarks(msg, rollNo, action);
  }
};

const registered = (action: "att" | "mid" | "bunk") => (msg: Message) => {
  handleRegisteredLookup(msg, action).catch((e) => {
    logger.error("[registered] lookup failed:", e);
    bot
      .sendMessage(
        msg.chat.id,
        "Something broke on my side. Try again in a bit.",
      )
      .catch(() => {});
  });
};

bot.onText(/\/attendance/, registered("att"));
bot.onText(/\/midmarks/, registered("mid"));
bot.onText(/\/bunk/, registered("bunk"));
