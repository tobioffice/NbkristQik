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
 *
 * The audit row is deduped per reader, document and page for an hour. Before
 * this, every re-render of a page wrote a row, so a reader who scrolled up
 * and down buried real traffic in their own noise and the table grew per
 * view. The row we keep still carries the watermark token, so a leaked page
 * still resolves to the reader it was served to. The burst counter below is
 * *not* deduped: it counts deliveries, which is exactly what a bulk pull
 * looks like.
 */

/** Pages one reader may pull in five minutes before it is worth a look. */
const BURST_LIMIT = 300;
const BURST_WINDOW_SECONDS = 300;

/** One audit row per reader, document and page in this window. */
const READ_DEDUPE_SECONDS = 60 * 60;

/**
 * The dedupe key lives here rather than in `redisKeys` on purpose: the
 * namespace is read by `cacheFlushPatterns` and by ops tooling, and a
 * per-delivery key with a one-hour life is not a cache to flush with the
 * student data. The prefix is greppable all the same.
 *
 * A whole-PDF download is recorded as page 0 and deduped under the suffix
 * `pdf`, so a download and a page view never suppress each other.
 */
const firstReadKey = (
  userId: string,
  docId: string,
  page: number | "pdf",
): string => `lib:read:${userId}:${docId}:${page}`;

/**
 * Claims the right to write this hour's audit row.
 *
 * `SET NX` makes the claim atomic across API workers. If Redis is down every
 * delivery is recorded: a duplicate row is cheaper than a missing one, and
 * the page must never fail because bookkeeping did.
 */
const claimFirstRead = async (
  userId: string,
  docId: string,
  page: number | "pdf",
): Promise<boolean> => {
  try {
    const client = await getClient();
    const claimed = await client.set(firstReadKey(userId, docId, page), "1", {
      NX: true,
      EX: READ_DEDUPE_SECONDS,
    });
    return claimed === "OK";
  } catch (e) {
    logger.warn(
      "[library] read dedupe unavailable, recording every delivery:",
      e,
    );
    return true;
  }
};

/**
 * Drops a claim whose audit row could not be written, so the next delivery
 * inside the window can try again. Best effort: if Redis is also down, the
 * next read simply writes its own row once Redis returns.
 */
const releaseFirstRead = async (
  userId: string,
  docId: string,
  page: number | "pdf",
): Promise<void> => {
  const client = await getClient();
  await client.del(firstReadKey(userId, docId, page));
};

/** Records that this student was served this page. Fire and forget. */
export const notePageRead = (
  userId: string,
  docId: string,
  page: number,
  token: string,
  surface?: "telegram" | "pc",
): void => {
  void (async () => {
    if (!(await claimFirstRead(userId, docId, page))) return;
    try {
      if (surface) await recordLibraryRead(userId, docId, page, token, surface);
      else await recordLibraryRead(userId, docId, page, token);
    } catch (e) {
      // a claim without a row is a lost audit entry: give it back
      await releaseFirstRead(userId, docId, page).catch(() => {});
      throw e;
    }
  })().catch((e) => logger.warn("[library] could not record a read:", e));
};

/**
 * Records that this student downloaded the whole document. Fire and forget.
 *
 * A download is the same audit fact as a page view, so it lands in the same
 * table as page 0 and carries the same token. It is deduped per reader and
 * document for an hour, separately from any page view.
 */
export const noteDownload = (
  userId: string,
  docId: string,
  token: string,
  surface?: "telegram" | "pc",
): void => {
  void (async () => {
    if (!(await claimFirstRead(userId, docId, "pdf"))) return;
    try {
      if (surface) await recordLibraryRead(userId, docId, 0, token, surface);
      else await recordLibraryRead(userId, docId, 0, token);
    } catch (e) {
      // a claim without a row is a lost audit entry: give it back
      await releaseFirstRead(userId, docId, "pdf").catch(() => {});
      throw e;
    }
  })().catch((e) => logger.warn("[library] could not record a download:", e));
};

/**
 * Counts pages per student over the burst window and complains when one
 * reader stands out. Best effort: if Redis is down the reading still works.
 *
 * This counts every delivery, even one whose audit row was deduped: a script
 * walking a unit still trips it.
 */
export const watchForBurst = async (
  userId: string,
  weight = 1,
): Promise<void> => {
  try {
    const client = await getClient();
    const key = redisKeys.libraryReads(userId);
    const count = await client.incrBy(key, Math.max(1, weight));
    if (count === Math.max(1, weight)) {
      await client.expire(key, BURST_WINDOW_SECONDS);
    }
    if (count > BURST_LIMIT) {
      logger.warn(
        `[library] user ${userId} pulled ${count} pages in five minutes`,
      );
    }
  } catch {
    // no counter, no complaint
  }
};
