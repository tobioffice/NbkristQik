import type { Express, Request, Response } from "express";
import { getOverviewTotals } from "../db/activityStats.model.js";
import { getUptimeSummary } from "../db/student_stats.model.js";
import { logger } from "../config/logger.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys } from "../services/redis/keys.js";
import { securityLogger } from "../middleware/security.js";

export interface PublicStats {
  generated_at: string;
  registered_users: number;
  dau: number;
  wau: number;
  mau: number;
  commands_7d: number;
  uptime_90d: string;
  method: string;
}

const METHOD =
  "users = rows in botusers (distinct Telegram users with at least one recorded action); " +
  "dau/wau/mau = distinct activity_log.user_id in the trailing 1/7/30 IST calendar days including today; " +
  "commands_7d = activity_log rows in the trailing 7 IST days; " +
  "uptime_90d = successful uptime_log probes / all probes across components, last 90 days; " +
  "aggregates only, no identifiers.";

/**
 * Server time in IST (`+05:30`), seconds precision, for example
 * `2026-11-18T10:30:00+05:30`. IST has no daylight saving, so the fixed
 * offset is exact.
 */
export const formatIstTimestamp = (date: Date): string =>
  `${new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 19)}+05:30`;

/**
 * Pool every component's probes: total ups / total pings. Averaging the
 * per-component percentages would let one quiet component outweigh a busy
 * one. No probes at all is "n/a", not 0%.
 */
const formatUptime90d = (
  components: Awaited<ReturnType<typeof getUptimeSummary>>,
): string => {
  let pings = 0;
  let ups = 0;
  for (const component of components) {
    pings += component.pings;
    ups += component.ups;
  }
  return pings > 0 ? `${((ups / pings) * 100).toFixed(1)}%` : "n/a";
};

export const buildPublicStats = async (): Promise<PublicStats> => {
  const [totals, uptime] = await Promise.all([
    getOverviewTotals(),
    getUptimeSummary(),
  ]);

  return {
    generated_at: formatIstTimestamp(new Date()),
    registered_users: totals.users,
    dau: totals.activeToday,
    wau: totals.active7d,
    mau: totals.active30d,
    commands_7d: totals.commands7d,
    uptime_90d: formatUptime90d(uptime),
    method: METHOD,
  };
};

const CACHE_TTL_SECONDS = 300;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;

// A Redis outage must not turn the public page into a database load tester:
// the last successful build is served for the rest of its five minutes even
// when every Redis call fails.
let fallbackCache: { at: number; json: string } | null = null;

const readFallback = (): string | null => {
  if (!fallbackCache) return null;
  if (Date.now() - fallbackCache.at >= CACHE_TTL_MS) return null;
  return fallbackCache.json;
};

const isJsonObject = (value: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
};

const getCachedStats = async (): Promise<{
  json: string;
  cache: "hit" | "miss";
}> => {
  try {
    const cached = await getClient().then((client) =>
      client.get(redisKeys.publicStats),
    );
    if (cached && isJsonObject(cached)) {
      return { json: cached, cache: "hit" };
    }
  } catch (e) {
    logger.warn("[stats] Redis read failed:", e);
  }

  const fallback = readFallback();
  if (fallback) return { json: fallback, cache: "hit" };

  const json = JSON.stringify(await buildPublicStats());
  fallbackCache = { at: Date.now(), json };

  try {
    await getClient().then((client) =>
      client.set(redisKeys.publicStats, json, { EX: CACHE_TTL_SECONDS }),
    );
  } catch (e) {
    logger.warn("[stats] Redis write failed:", e);
  }

  return { json, cache: "miss" };
};

/**
 * Mounts GET /api/stats — aggregate-only usage counts for the public /stats
 * page. The totals come from the same queries as the admin overview.
 */
export const registerPublicStatsRoutes = (app: Express): void => {
  app.get(
    "/api/stats",
    securityLogger,
    async (_req: Request, res: Response) => {
      try {
        const { json, cache } = await getCachedStats();
        res.set(
          "Cache-Control",
          "public, max-age=300, stale-while-revalidate=60",
        );
        res.set("X-Stats-Cache", cache);
        res.type("json").send(json);
      } catch (error) {
        logger.error("[stats] /api/stats failed:", error);
        res.set("Cache-Control", "no-store");
        res
          .status(500)
          .json({ success: false, error: "Internal Server Error" });
      }
    },
  );
};
