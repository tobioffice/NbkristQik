import { bot } from "./bot.js";
import { checkMembership } from "../services/student.utils/checkMembership.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys } from "../services/redis/keys.js";
import { ADMIN_ID } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import { PROTECTED_CHAT_ID } from "../constants/index.js";
import { CHANNEL_USERNAME } from "../constants/telegram.js";
import { JOIN_CHANNEL } from "./replies.js";

/**
 * The gate in front of every answer.
 *
 * Two questions, in order: is this the admin, and is this person in the
 * channel. Every entry point — a typed roll number, a tapped button, a
 * registered command — asks the same questions through this one function, so
 * no path can answer with a gate missing.
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

/** A student who has not joined the channel gets this card instead. */
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

export interface AuthorizationRequest {
  userId: number;
  /** The chat the student asked from. */
  chatId: number;
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
  joinPromptChatId = chatId,
}: AuthorizationRequest): Promise<boolean> => {
  // the admin is never gated: no membership check
  if (userId === ADMIN_ID) return true;

  let isMember = await getCachedMembership(userId);
  if (!isMember) {
    try {
      isMember = await checkMembership(userId);
    } catch (e) {
      logger.warn("[auth] membership check failed:", e);
      // cannot verify membership right now — let the request through rather
      // than locking out members on a bad minute
      isMember = true;
    }
  }

  if (!isMember && chatId !== PROTECTED_CHAT_ID) {
    await sendJoinChannelMsg(joinPromptChatId);
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
