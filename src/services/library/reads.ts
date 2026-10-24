import { getClient } from "../redis/getRedisClient.js";
import { redisKeys } from "../redis/keys.js";
import { logger } from "../../config/logger.js";
import { recordLibraryRead } from "../../db/library.model.js";

/**
 * Reading bookkeeping.
 *
 * Two things are worth remembering about a page we served: that it went out
 * (the audit trail behind a takedown) and that it went out in a hurry (a
 * whole unit pulled in a minute is a copy, not a read). Neither is allowed to
 * stand between the student and the page: a failed write is logged, not
 * thrown.
 */

/** Pages one reader may pull in five minutes before it is worth a look. */
const BURST_LIMIT = 300;
const BURST_WINDOW_SECONDS = 300;

/** Records that this student was served this page. Fire and forget. */
export const notePageRead = (
  userId: string,
  docId: string,
  page: number,
  token: string,
): void => {
  void recordLibraryRead(userId, docId, page, token).catch((e) =>
    logger.warn("[library] could not record a read:", e),
  );
};

/**
 * Counts pages per student over the burst window and complains when one
 * reader stands out. Best effort: if Redis is down the reading still works.
 */
export const watchForBurst = async (userId: string): Promise<void> => {
  try {
    const client = await getClient();
    const key = redisKeys.libraryReads(userId);
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, BURST_WINDOW_SECONDS);
    if (count > BURST_LIMIT) {
      logger.warn(
        `[library] user ${userId} pulled ${count} pages in five minutes`,
      );
    }
  } catch {
    // no counter, no complaint
  }
};
