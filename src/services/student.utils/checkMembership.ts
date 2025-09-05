import { bot } from "../../bot/bot.js";
import { CHANNEL_ID } from "../../config/environmentals.js";

export const checkMembership = async (userId: number): Promise<boolean> => {
  try {
    const member = await bot.getChatMember(CHANNEL_ID, userId);
    return ["member", "creator", "administrator"].includes(member.status);
  } catch (error) {
    console.log("error from checkMembership: " + error);
    return false;
  }
};
