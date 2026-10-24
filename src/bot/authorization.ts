import { bot } from "./bot.js";
import { checkMembership } from "../services/student.utils/checkMembership.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys } from "../services/redis/keys.js";
import { ADMIN_ID } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import { PROTECTED_CHAT_ID } from "../constants/index.js";
import { CHANNEL_USERNAME } from "../constants/telegram.js";
import { isDailyUnlocked, getCheckInLink } from "./dailyCheckIn.js";
import { CHECK_IN_PROMPT, JOIN_CHANNEL } from "./replies.js";

/**
 * The gate in front of every answer.
 *
 * Three questions, in order: is this the admin, is this person in the channel,
 * and have they checked in today. Every entry point — a typed roll number, a
 * tapped button, a registered command — asks the same questions through this
 * one function, so no path can answer with a gate missing.
 */

/** The membership flag the join check writes, read back cheaply. */
const getCachedMembership = async (userId: number): Promise<boolean> => {
  try {
    const redis = await getClient();
    return (await redis.get(redisKeys.isMember(userId))) === "true";
  } catch (e) {
    // Redis down must not break authorization: fall through to the live check
    logger.warn("[auth] membership cache read failed:", e);
    return false;
  }
};

/** The card that asks a student to join the channel first. */
const sendJoinChannelMsg = async (chatId: number): Promise<void> => {
  const channel = CHANNEL_USERNAME;
  await bot.sendMessage(chatId, JOIN_CHANNEL, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `Join @${channel}`, url: `https://t.me/${channel}` }],
      ],
    },
  });
};

/** A student who has not checked in today gets the pinned post instead. */
const sendCheckInPrompt = async (
  chatId: number,
  replyToMessageId?: number,
): Promise<void> => {
  await bot.sendMessage(chatId, CHECK_IN_PROMPT, {
    parse_mode: "HTML",
    // as a reply to the student's own message, so it is clearly for them
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    reply_markup: {
      inline_keyboard: [
        [{ text: "👇 I'm not a robot", url: await getCheckInLink() }],
      ],
    },
  });
};

export interface AuthorizationRequest {
  userId: number;
  /** The chat the student asked from. */
  chatId: number;
  /** The message the answer should hang off, when there is one. */
  replyToMessageId?: number;
  /**
   * Where the "join the channel" card goes. Defaults to the chat that asked;
   * the roll-number flow sends it privately instead, so a group never sees a
   * card that only makes sense to one person.
   */
  joinPromptChatId?: number;
}

/** True when this student may be answered. Sends the reason when not. */
export const isAuthorizedUser = async ({
  userId,
  chatId,
  replyToMessageId,
  joinPromptChatId = chatId,
}: AuthorizationRequest): Promise<boolean> => {
  // the admin is never gated: no membership check, no check-in
  if (userId === ADMIN_ID) return true;

  let isMember = await getCachedMembership(userId);
  if (!isMember) {
    try {
      isMember = await checkMembership(userId);
    } catch (e) {
      logger.warn("[auth] membership check failed:", e);
      // cannot verify membership right now — let the request through rather
      // than locking out members (the daily gate still applies below)
      isMember = true;
    }
  }

  if (!isMember && chatId !== PROTECTED_CHAT_ID) {
    await sendJoinChannelMsg(joinPromptChatId);
    return false;
  }

  // dormant until /postcheckin creates the post
  if (!(await isDailyUnlocked(userId))) {
    await sendCheckInPrompt(chatId, replyToMessageId);
    return false;
  }

  return true;
};

/** Remembers the student so a broadcast can reach them later. Best effort. */
export const rememberStudent = async (userId: number): Promise<void> => {
  try {
    const redis = await getClient();
    await redis.sAdd(redisKeys.broadcastUsers, String(userId));
  } catch (e) {
    logger.error("[auth] could not remember the student:", e);
  }
};
