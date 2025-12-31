import { bot } from "../../bot/bot.js";
import { CHANNEL_ID } from "../../config/environmentals.js";
import { getClient } from "../redis/getRedisClient.js";

export const checkMembership = async (userId: number): Promise<boolean> => {
   const member = await bot.getChatMember(CHANNEL_ID, userId);
   const isMember = ["member", "creator", "administrator"].includes(
      member.status
   );
   if (isMember) {
      const redisClient = await getClient();
      await redisClient.set(`isMember:${userId}`, "true", {
         EX: 24 * 60 * 60, // 1 day
      });
   }
   return isMember;
};
