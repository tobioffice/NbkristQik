/**
 * CLI entry for the semester sync.
 *
 *   node dist/bot/syncdbCli.js            # use the stored semester type
 *   node dist/bot/syncdbCli.js 1          # odd sems (11/21/31/41), and store it
 *   node dist/bot/syncdbCli.js 2          # even sems (12/22/32/42), and store it
 *   node dist/bot/syncdbCli.js 1 2025-26  # explicit academic year too
 *
 * Runs the same engine as the /syncdb Telegram command (see runSyncDb), so the
 * students table can be (re)filled from the server: after a database cutover,
 * from cron at semester start, or when the chat is inconvenient. Progress goes
 * to stdout instead of a Telegram message.
 */
import "dotenv/config";

import { runSyncDb } from "./syncdb.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys } from "../services/redis/keys.js";
import { logger } from "../config/logger.js";

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, "");

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const semArg = argv.find((a) => /^[12]$/.test(a)) ?? null;
  const yearArg = argv.find((a) => /^\d{4}-\d{2}$/.test(a));

  const redis = await getClient();
  const stored = await redis.get(redisKeys.syncSemType);
  const semType = semArg ?? stored ?? null; // "1" | "2" | null (all 8 sessions)

  const label =
    semType === "1"
      ? "1st sems (11/21/31/41)"
      : semType === "2"
        ? "2nd sems (12/22/32/42)"
        : "all 8 sessions (slower; pass 1 or 2 to narrow)";

  console.log(
    `[syncdb-cli] semester mode: ${label}${yearArg ? `, academic year ${yearArg}` : ""}`,
  );

  // mirror /syncdb: an explicit argument is remembered for future runs
  if (semArg && semArg !== stored) {
    await redis.set(redisKeys.syncSemType, semArg);
    console.log(`[syncdb-cli] stored semester type ${semArg} for /syncdb too`);
  }

  const started = Date.now();
  let lastLine = "";

  const result = await runSyncDb({
    semType,
    yearArg,
    onProgress: (p) => {
      const line = p.lines[p.lines.length - 1];
      if (line && line !== lastLine) {
        lastLine = line;
        console.log(`[syncdb-cli] ${stripTags(line)}`);
      }
    },
  });

  console.log(
    `[syncdb-cli] DONE in ${Math.round((Date.now() - started) / 1000)}s — students=${result.students} updated=${result.updated} failed=${result.upsertFailed}`,
  );
  console.log(`[syncdb-cli] per-session: ${result.perYear}`);
};

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    logger.error(
      "[syncdb-cli] failed:",
      e instanceof Error ? e.message : String(e),
    );
    process.exit(1);
  });
