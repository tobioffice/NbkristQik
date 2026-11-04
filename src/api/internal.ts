import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Express } from "express";
import { getClient } from "../services/redis/getRedisClient.js";
import { recordHeartbeatsAt } from "../db/student_stats.model.js";
import { turso } from "../db/db.js";
import { UPTIME_INGEST_SECRET } from "../config/environmentals.js";
import { createRateLimit, securityLogger } from "../middleware/security.js";
import { logger } from "../config/logger.js";

/**
 * Private endpoints for the uptime monitor on oracle2.
 *
 * The monitor runs outside this host so a dead VM still raises an alert and
 * its missed checks are recorded. It reads the local dependency status here
 * and posts the heartbeats back; both routes are hidden unless
 * UPTIME_INGEST_SECRET is set.
 */
const COMPONENTS = ["api", "portal", "database", "redis"] as const;
type Component = (typeof COMPONENTS)[number];
type ComponentStatus = "up" | "down";

const STATUSES: ComponentStatus[] = ["up", "down"];
const SQLITE_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const RETENTION_DAYS = 95;
const MAX_ROWS = 200;
const DEEP_TIMEOUT_MS = 3000;
// Same floor as the monitor's assertConfig: a short bearer secret is brute
// forceable, so a misconfigured deployment fails closed instead of exposing
// the routes with a weak token.
const MIN_SECRET_LENGTH = 32;

type HeartbeatRow = {
  component: Component;
  status: ComponentStatus;
  latencyMs: number | null;
  at: string;
};

/** Compares two secrets without leaking length or prefix through timing. */
const secretMatches = (provided: string, expected: string): boolean => {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
};

const requireSecret = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const header = req.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!provided || !secretMatches(provided, UPTIME_INGEST_SECRET)) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  next();
};

const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const check = async (
  component: Component,
  probe: () => Promise<void>,
): Promise<{
  component: Component;
  status: ComponentStatus;
  latencyMs: number | null;
}> => {
  const start = Date.now();
  try {
    await withTimeout(probe(), DEEP_TIMEOUT_MS);
    return { component, status: "up", latencyMs: Date.now() - start };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.debug(`[internal] ${component} probe failed: ${message}`);
    return { component, status: "down", latencyMs: null };
  }
};

export const isValidTimestamp = (at: unknown): at is string => {
  if (typeof at !== "string" || !SQLITE_TIMESTAMP.test(at)) return false;

  const ms = Date.parse(`${at.replace(" ", "T")}Z`);
  if (!Number.isFinite(ms)) return false;

  const age = Date.now() - ms;
  // a replayed row is still useful for 95 days; anything in the future is
  // a clock problem, not history
  return age <= RETENTION_DAYS * 24 * 60 * 60 * 1000 && age >= -10 * 60 * 1000;
};

export const isHeartbeatRow = (value: unknown): value is HeartbeatRow => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;

  return (
    typeof row.component === "string" &&
    COMPONENTS.includes(row.component as Component) &&
    typeof row.status === "string" &&
    STATUSES.includes(row.status as ComponentStatus) &&
    (row.latencyMs === null ||
      (typeof row.latencyMs === "number" &&
        Number.isInteger(row.latencyMs) &&
        row.latencyMs >= 0 &&
        row.latencyMs <= 300000)) &&
    isValidTimestamp(row.at)
  );
};

export const registerInternalRoutes = (app: Express): void => {
  if (!UPTIME_INGEST_SECRET) {
    logger.info(
      "[internal] UPTIME_INGEST_SECRET is unset — uptime endpoints are disabled",
    );
    return;
  }

  if (UPTIME_INGEST_SECRET.length < MIN_SECRET_LENGTH) {
    logger.error(
      `[internal] UPTIME_INGEST_SECRET is shorter than ${MIN_SECRET_LENGTH} characters — uptime endpoints are disabled`,
    );
    return;
  }

  // The monitor makes a handful of calls per hour; this only stops a leaked
  // secret from being used to hammer the local database.
  const limit = createRateLimit(
    15 * 60 * 1000,
    120,
    "Too many uptime requests, please try again later.",
  );

  app.get(
    "/internal/health",
    securityLogger,
    limit,
    requireSecret,
    async (_req: Request, res: Response) => {
      const components = await Promise.all([
        check("database", async () => {
          await turso.execute("SELECT 1");
        }),
        check("redis", async () => {
          const redis = await getClient();
          await redis.ping();
        }),
      ]);

      res.set("Cache-Control", "no-store");
      res.json({ success: true, components });
    },
  );

  app.post(
    "/internal/uptime",
    securityLogger,
    limit,
    requireSecret,
    async (req: Request, res: Response) => {
      const rows = (req.body as { rows?: unknown } | undefined)?.rows;

      if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
        res.status(400).json({
          success: false,
          error: `Expected 1-${MAX_ROWS} heartbeat rows`,
        });
        return;
      }

      if (!rows.every(isHeartbeatRow)) {
        res
          .status(400)
          .json({ success: false, error: "Invalid heartbeat row" });
        return;
      }

      try {
        // One transaction for the whole spool chunk. The rows are idempotent
        // by (component, created_at), so a retry writes only the missing tail.
        await recordHeartbeatsAt(rows);
        res.set("Cache-Control", "no-store");
        res.json({ success: true, stored: rows.length });
      } catch (e) {
        logger.error("[internal] heartbeat write failed:", e);
        res
          .status(500)
          .json({ success: false, error: "Could not store heartbeats" });
      }
    },
  );
};
