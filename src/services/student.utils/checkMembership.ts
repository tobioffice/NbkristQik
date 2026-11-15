import { bot } from "../../bot/bot.js";
import { CHANNEL_ID } from "../../config/environmentals.js";
import { getClient } from "../redis/getRedisClient.js";
import { redisKeys } from "../redis/keys.js";
import { logger } from "../../config/logger.js";

export const checkMembership = async (userId: number): Promise<boolean> => {
  const member = await bot.api.getChatMember({
    chat_id: CHANNEL_ID,
    user_id: userId,
  });
  const isMember = ["member", "creator", "administrator"].includes(
    member.status,
  );
  if (isMember) {
    try {
      const redisClient = await getClient();
      await redisClient.set(redisKeys.isMember(userId), "true", {
        EX: 24 * 60 * 60, // 1 day
      });
    } catch (e) {
      // caching is an optimization — the live answer still stands
      logger.warn("[checkMembership] cache write failed:", e);
    }
  }
  return isMember;
};
