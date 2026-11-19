import { getClient } from "../redis/getRedisClient.js";
import { redisKeys } from "../redis/keys.js";
import { logger } from "../../config/logger.js";

/**
 * How often one reader may ask the bot to send a document.
 *
 * A send is an upload plus a message, so it is the most expensive thing the
 * library does for a reader. Six an hour is generous for a student working
 * through the units of a subject and useless for anyone scraping the shelf.
 *
 * A Redis failure fails open: the session itself lives in Redis, so a reader
 * who gets this far already had a working Redis, and a limiter that could not
 * count must not turn into "the library is shut". The global API limit still
 * applies.
 */
export const SEND_LIMIT = 6;
export const SEND_WINDOW_SECONDS = 60 * 60;

export interface SendCharge {
  allowed: boolean;
  /** Seconds until the window frees a slot, when it is full. */
  retryAfter: number;
}

export const chargeDocumentSend = async (
  userId: string | number,
): Promise<SendCharge> => {
  const key = redisKeys.librarySend(userId);
  try {
    const client = await getClient();
    // Arm the window before counting. SET ... NX EX is one atomic step, so
    // a process crash between the count and the timer cannot leave a
    // TTL-less key — that would tell the reader "try again in 60 min"
    // forever. For a live window the NX arm is a no-op.
    await client.set(key, "0", { NX: true, EX: SEND_WINDOW_SECONDS });
    const count = await client.incr(key);
    if (count <= SEND_LIMIT) return { allowed: true, retryAfter: 0 };

    const ttl = await client.ttl(key).catch(() => -1);
    if (ttl === -1) {
      // a window that predates the arm (or lost its TTL to a crash) would
      // never free a slot: repair it so the reader is not locked out forever
      await client.expire(key, SEND_WINDOW_SECONDS).catch(() => {});
    }
    return {
      allowed: false,
      retryAfter: ttl > 0 ? ttl : SEND_WINDOW_SECONDS,
    };
  } catch (e) {
    logger.warn("[library] send limiter unavailable:", e);
    return { allowed: true, retryAfter: 0 };
  }
};
