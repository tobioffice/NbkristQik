import express, { Request, Response } from "express";
import cors from "cors";
import { existsSync } from "fs";
import path from "path";
import {
  getLeaderboard,
  getLeaderboardFacets,
  getLastSyncAt,
  getStudentRank,
  getUptimeSummary,
  getUptimeDailyBuckets,
} from "../db/student_stats.model.js";
import { getTgUserRoll } from "../db/student.model.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys } from "../services/redis/keys.js";
import { resolveUserId } from "./resolveUser.js";
import { trackActivity } from "../services/tracker.js";
import {
  leaderboardSecurityMiddlewares,
  apiSecurityMiddlewares,
  securityLogger,
  createRateLimit,
} from "../middleware/security.js";
import { PORT, CORS_ORIGINS } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import { registerAdminRoutes } from "./admin/index.js";
import { profileRouter } from "./profile.js";
import { reportRouter } from "./report.js";
import { libraryRouter } from "./library.js";

export const app = express();

// Behind nginx on oracle3: trust the single proxy hop so req.ip and
// express-rate-limit see the real client IP, not 127.0.0.1.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: CORS_ORIGINS,
  }),
);

app.use(express.json());

// Admin panel first: it must not run through the global body sanitizer
// (which strips angle brackets — it would mangle passwords containing them)
// and has its own auth + login rate limiting instead.
registerAdminRoutes(app);

// The library mini app, served from this same origin so its session cookie
// is first-party. Mounted before the global middlewares: it is static files,
// it needs no body sanitising, and it should not spend the API rate limit.
const libraryWebDir =
  process.env.LIBRARY_WEB_DIR?.trim() ||
  path.resolve(process.cwd(), "public", "library");
if (existsSync(libraryWebDir)) {
  app.use(
    "/library",
    express.static(libraryWebDir, {
      index: "index.html",
      maxAge: "1h",
      setHeaders: (res) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
      },
    }),
  );
} else {
  logger.warn(
    `[library] web bundle not found at ${libraryWebDir} — /library will not open`,
  );
}

// Apply security middleware to all routes
app.use(apiSecurityMiddlewares);

// Profile/registration endpoints: identity-authenticated, writes rate-limited
// harder than the global limit (bot-side flows are the intended entry).
const profileWriteLimit = createRateLimit(
  15 * 60 * 1000,
  20,
  "Too many profile updates, please try again later.",
);
app.use("/api/register", profileWriteLimit);
app.use("/api", profileRouter);

// Report endpoints: identity-authenticated; submits rate-limited per IP and
// further throttled per user in the service (60 s gate, fail-open).
const reportWriteLimit = createRateLimit(
  15 * 60 * 1000,
  5,
  "Too many reports, please try again later.",
);
app.use("/api/report", reportWriteLimit);

// Report threads: reads and follow-up messages are conversation-paced, so
// they get a roomier IP limit on top of the per-user 3 s gate in the service.
// Mounted before the report router for clarity; `/api/report` above never
// matches `/api/thread`.
const threadLimit = createRateLimit(
  15 * 60 * 1000,
  120,
  "Too many thread requests, please try again later.",
);
app.use("/api/thread", threadLimit);
app.use("/api", reportRouter);

// Library web app: session exchange, then the student's own subject list.
// The session exchange is the only way in, so it gets its own tight limit;
// everything after it rides on the global API limit.
const librarySessionLimit = createRateLimit(
  60 * 60 * 1000,
  20,
  "Too many library sessions, please try again later.",
);
app.use("/api/library/session", librarySessionLimit);
app.use("/api/library", libraryRouter);

interface LeaderboardQuery {
  page: number;
  limit: number;
  sortBy: "attendance" | "midmarks";
  filters: {
    year?: string;
    branch?: string;
    section?: string;
    search?: string;
  };
}

const parseLeaderboardQuery = (req: Request): LeaderboardQuery => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const sortBy = (req.query.sort as "attendance" | "midmarks") || "attendance";

  const filters = {
    year: req.query.year === "all" ? undefined : (req.query.year as string),
    branch:
      req.query.branch === "all" ? undefined : (req.query.branch as string),
    section:
      req.query.section === "all" ? undefined : (req.query.section as string),
    search: req.query.search
      ? String(req.query.search).trim().slice(0, 20)
      : undefined,
  };
  return { page, limit, sortBy, filters };
};

const leaderboardCacheKey = (q: LeaderboardQuery): string =>
  redisKeys.leaderboard(
    `${q.sortBy}:${q.page}:${q.limit}:${q.filters.year || "all"}:${q.filters.branch || "all"}:${q.filters.section || "all"}:${q.filters.search || ""}`,
  );

// 60s Redis cache per unique query — protects Turso read quota (best-effort)
const getCachedLeaderboard = async (
  cacheKey: string,
): Promise<string | null> => {
  try {
    return await getClient().then((c) => c.get(cacheKey));
  } catch (e) {
    logger.warn("[API] leaderboard cache read failed:", e);
    return null;
  }
};

const cacheLeaderboard = async (cacheKey: string, payload: object) => {
  try {
    await getClient().then((c) =>
      c.set(cacheKey, JSON.stringify(payload), { EX: 60 }),
    );
  } catch (e) {
    logger.warn("[API] leaderboard cache write failed:", e);
  }
};

const buildLeaderboardPayload = async (query: LeaderboardQuery) => {
  const { rows, total } = await getLeaderboard(
    query.sortBy,
    query.limit,
    (query.page - 1) * query.limit,
    query.filters,
  );

  // Freshness and the live section list belong to the first page only;
  // later pages already have them, and each extra query costs Turso reads.
  const asOf =
    query.page === 1
      ? await Promise.all([
          getLastSyncAt(),
          getLeaderboardFacets(query.filters),
        ])
      : null;

  return {
    success: true,
    page: query.page,
    limit: query.limit,
    total,
    data: rows,
    updated_at: asOf ? asOf[0] : null,
    facets: asOf ? { sections: asOf[1] } : null,
  };
};

// API Routes
app.get(
  "/api/leaderboard",
  leaderboardSecurityMiddlewares,
  async (req: Request, res: Response) => {
    try {
      const query = parseLeaderboardQuery(req);
      const cacheKey = leaderboardCacheKey(query);

      // same payload for everyone, and the source data is refreshed by
      // /syncdb anyway — let the webview serve repeat opens from its own
      // cache instead of the network (both the warm and the cold path)
      res.set("Cache-Control", "public, max-age=30");

      const cached = await getCachedLeaderboard(cacheKey);
      if (cached) {
        res.json(JSON.parse(cached));
        return;
      }

      const payload = await buildLeaderboardPayload(query);
      await cacheLeaderboard(cacheKey, payload);

      res.json(payload);
    } catch (error) {
      logger.error("Error fetching leaderboard:", error);
      res.status(500).json({ success: false, error: "Internal Server Error" });
    }
  },
);

app.get(
  "/api/me",
  leaderboardSecurityMiddlewares,
  async (req: Request, res: Response) => {
    try {
      const resolved = resolveUserId(req);
      if (!resolved) {
        res
          .status(401)
          .json({ found: false, error: "Telegram initData required" });
        return;
      }
      if (resolved.error) {
        res.status(401).json({ found: false, error: resolved.error });
        return;
      }

      // a verified initData call means the student opened the leaderboard
      // web app — worth counting even if they have no roll mapped yet
      trackActivity({
        userId: Number(resolved.userId),
        chatType: "unknown",
        action: "leaderboard_webapp",
      });

      const rollNo = await getTgUserRoll(resolved.userId);
      if (!rollNo) {
        res.json({ found: false });
        return;
      }

      const [attendance, midmarks] = await Promise.all([
        getStudentRank(rollNo, "attendance"),
        getStudentRank(rollNo, "midmarks"),
      ]);

      res.json({
        found: true,
        roll_no: rollNo,
        attendance: attendance
          ? {
              rank: attendance.rank,
              total: attendance.total,
              value: attendance.value,
            }
          : null,
        midmarks: midmarks
          ? {
              rank: midmarks.rank,
              total: midmarks.total,
              value: midmarks.value,
            }
          : null,
      });
    } catch (error) {
      logger.error("Error fetching /api/me:", error);
      res.status(500).json({ found: false, error: "Internal Server Error" });
    }
  },
);

// Health check endpoint (no rate limiting)
app.get("/health", securityLogger, (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: "1.0.0",
  });
});

/**
 * The 60 s Redis cache only helps while traffic is flowing. With a small user
 * base, the first student to open the app after a quiet minute otherwise pays
 * the full ~1 s cold Turso query before the first row renders. Keeping the
 * two default views warm costs two queries every 50 s, before the TTL can
 * lapse, so every open hits the cache.
 */
const WARM_LEADERBOARD_QUERIES: LeaderboardQuery[] = [
  { page: 1, limit: 20, sortBy: "attendance", filters: {} },
  { page: 1, limit: 20, sortBy: "midmarks", filters: {} },
];

const warmLeaderboardCache = async () => {
  await Promise.all(
    WARM_LEADERBOARD_QUERIES.map(async (query) => {
      try {
        await cacheLeaderboard(
          leaderboardCacheKey(query),
          await buildLeaderboardPayload(query),
        );
      } catch (e) {
        logger.debug("[API] leaderboard warm refresh failed:", e);
      }
    }),
  );
};

// Pro status page — 90-day uptime summary + daily bars.
// The underlying data only changes on the 5-min probe, so the assembled
// payload is cached in-memory for 5 minutes instead of rebuilt per request.
const STATUS_TTL_MS = 5 * 60 * 1000;
let statusCache: { at: number; payload: string } | null = null;

const computeStatusComponents = async () => {
  const summary = await getUptimeSummary();
  return Promise.all(
    summary.map(async (s) => {
      const lastPingAgeSec = Math.floor(
        (Date.now() - new Date(s.lastPing + "Z").getTime()) / 1000,
      );
      // up = the newest heartbeat said up, and it is recent. A down probe
      // also writes a heartbeat, so age alone would report an outage as "up".
      const current: "up" | "down" =
        s.lastStatus === "up" && lastPingAgeSec < 15 * 60 ? "up" : "down";
      return {
        component: s.component,
        uptimePct: s.uptimePct,
        pings: s.pings,
        lastPing: s.lastPing,
        lastPingAgeSec,
        avgLatencyMs: s.avgLatencyMs,
        current,
        buckets: await getUptimeDailyBuckets(s.component, 90),
      };
    }),
  );
};

app.get("/api/status", securityLogger, async (_req: Request, res: Response) => {
  try {
    if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) {
      res.type("json").send(statusCache.payload);
      return;
    }

    const components = await computeStatusComponents();
    statusCache = {
      at: Date.now(),
      payload: JSON.stringify({ success: true, components }),
    };
    res.type("json").send(statusCache.payload);
  } catch (error) {
    logger.error("Error in /api/status:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export const startServer = () => {
  const server = app.listen(PORT, () => {
    logger.info(`🚀 API Server running on port ${PORT} with security enabled`);
  });
  server.on("error", (e) => {
    logger.error("[API] server error:", e);
  });

  // keep the default views warm forever: the first student to open the app
  // after a quiet minute must not pay the full cold Turso query
  void warmLeaderboardCache();
  const warmTimer = setInterval(() => {
    void warmLeaderboardCache();
  }, 50_000);
  warmTimer.unref();
  return server;
};
