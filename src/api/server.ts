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
import { getRegistration } from "../db/registration.model.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys } from "../services/redis/keys.js";
import { resolveOptionalIdentity } from "./resolveUser.js";
import {
  canOpenLibrary,
  canPreviewEverything,
} from "../services/library/access.js";
import { trackActivity } from "../services/tracker.js";
import {
  leaderboardSecurityMiddlewares,
  apiSecurityMiddlewares,
  securityLogger,
  createRateLimit,
} from "../middleware/security.js";
import { PORT, HOST, CORS_ORIGINS } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import { registerAdminRoutes } from "./admin/index.js";
import { profileRouter } from "./profile.js";
import { reportRouter } from "./report.js";
import { libraryRouter } from "./library.js";
import { registerInternalRoutes } from "./internal.js";

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
      setHeaders: (res, filePath) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");

        // The mini app's HTML references hashed bundles, so the HTML itself
        // must be revalidated (a deploy would otherwise pin the old bundle
        // for an hour); the hashed /assets/* files may be cached forever.
        // Inside the static handler Express has already stripped the mount
        // path from req.path, so check both the request and the disk path.
        const requestPath = res.req?.path ?? "";
        const isAsset =
          requestPath.startsWith("/library/assets/") ||
          requestPath.startsWith("/assets/") ||
          filePath.includes(`${path.sep}assets${path.sep}`);
        if (isAsset) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (
          requestPath.endsWith("/") ||
          requestPath.endsWith("/index.html") ||
          filePath.endsWith(".html")
        ) {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          res.setHeader("Cache-Control", "public, max-age=3600");
        }
      },
    }),
  );
} else {
  logger.warn(
    `[library] web bundle not found at ${libraryWebDir} — /library will not open`,
  );
}

/**
 * Static status page. The deploy workflow copies src/status to
 * public/status; until that happens (or on a dev box) answer a clean 404
 * instead of crashing the API.
 *
 * Path is read per request so tests can point STATUS_PAGE_PATH at a fixture.
 */
const defaultStatusPage = path.resolve(
  process.cwd(),
  "public",
  "status",
  "index.html",
);

app.get("/status", (_req: Request, res: Response) => {
  const statusPage = process.env.STATUS_PAGE_PATH?.trim() || defaultStatusPage;
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(
    statusPage,
    {
      cacheControl: false,
      headers: { "Cache-Control": "no-store" },
    },
    (error) => {
      if (!error) return;
      if (!res.headersSent) {
        res.status(404).json({ success: false, error: "Not Found" });
      }
    },
  );
});

// Apply security middleware to all routes
app.use(apiSecurityMiddlewares);

// Private endpoints for the external uptime monitor on oracle2. Hidden
// unless UPTIME_INGEST_SECRET is configured.
registerInternalRoutes(app);

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

/**
 * Cache key. The `names`/`anon` segment is security-critical: a cached
 * identified page carries names and must never be served to an anonymous
 * caller (or vice versa: an empty anonymous page must not hide names from a
 * signed-in student on the next request).
 */
const leaderboardCacheKey = (
  q: LeaderboardQuery,
  includeNames: boolean,
): string =>
  redisKeys.leaderboard(
    `${includeNames ? "names" : "anon"}:${q.sortBy}:${q.page}:${q.limit}:${q.filters.year || "all"}:${q.filters.branch || "all"}:${q.filters.section || "all"}:${q.filters.search || ""}`,
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

const buildLeaderboardPayload = async (
  query: LeaderboardQuery,
  includeNames: boolean,
) => {
  const { rows, total } = await getLeaderboard(
    query.sortBy,
    query.limit,
    (query.page - 1) * query.limit,
    query.filters,
    // Names (and name search) only for a verified Telegram identity. The DB
    // nulls the column and restricts search for anonymous callers.
    { includeNames, searchNames: includeNames },
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

  // Defence in depth: the SQL already selects NULL for anonymous callers,
  // but never serialize a name just because a stale/other-layer row carried
  // one. The public cache must be name-free at the point it is written.
  const data = includeNames
    ? rows
    : rows.map((row) => ({ ...row, name: null }));

  return {
    success: true,
    page: query.page,
    limit: query.limit,
    total,
    data,
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
      const identity = resolveOptionalIdentity(req);
      if (identity.status === "invalid") {
        // A presented-but-bad signature is never downgraded to anonymous:
        // that would let a broken client silently change what it sees.
        res.status(401).json({ success: false, error: identity.error });
        return;
      }

      const identified = identity.status === "authenticated";
      const query = parseLeaderboardQuery(req);
      const cacheKey = leaderboardCacheKey(query, identified);

      // Identified payloads carry names, so they go to one browser only;
      // anonymous payloads are identical for everyone and may be shared.
      res.set(
        "Cache-Control",
        identified ? "private, max-age=30" : "public, max-age=30",
      );

      const cached = await getCachedLeaderboard(cacheKey);
      if (cached) {
        res.json(JSON.parse(cached));
        return;
      }

      const payload = await buildLeaderboardPayload(query, identified);
      await cacheLeaderboard(cacheKey, payload);

      res.json(payload);
    } catch (error) {
      logger.error("Error fetching leaderboard:", error);
      res.status(500).json({ success: false, error: "Internal Server Error" });
    }
  },
);

/**
 * Public, identity-aware feature flags. The frontend uses this to hide the
 * library when it is closed (the admin can still open it) and to show admin
 * affordances. No identity is required; a provided-but-invalid one is 401 so
 * a broken Telegram client does not silently look anonymous.
 */
app.get("/api/config", async (req: Request, res: Response) => {
  try {
    const identity = resolveOptionalIdentity(req);
    if (identity.status === "invalid") {
      res.status(401).json({
        libraryOpen: false,
        admin: false,
        error: identity.error,
      });
      return;
    }

    const userId = identity.status === "authenticated" ? identity.userId : null;

    res.set("Cache-Control", "no-store");
    res.json({
      libraryOpen: userId ? canOpenLibrary(userId) : false,
      admin: userId ? canPreviewEverything(userId) : false,
    });
  } catch (error) {
    logger.error("Error fetching /api/config:", error);
    res.status(500).json({
      libraryOpen: false,
      admin: false,
      error: "Internal Server Error",
    });
  }
});

app.get(
  "/api/me",
  leaderboardSecurityMiddlewares,
  async (req: Request, res: Response) => {
    try {
      const identity = resolveOptionalIdentity(req);
      if (identity.status === "anonymous") {
        res
          .status(401)
          .json({ found: false, error: "Telegram initData required" });
        return;
      }
      if (identity.status === "invalid") {
        res.status(401).json({ found: false, error: identity.error });
        return;
      }

      // a verified initData call means the student opened the leaderboard
      // web app — worth counting even if they have no roll mapped yet
      trackActivity({
        userId: Number(identity.userId),
        chatType: "unknown",
        action: "leaderboard_webapp",
      });

      // An explicit registration is the student's stated roll and beats the
      // last roll they happened to look up (tgusers is auto-upserted by every
      // /attendance-style lookup, including a friend's).
      const registration = await getRegistration(identity.userId).catch(
        () => null,
      );
      const rollNo =
        registration?.roll_no ?? (await getTgUserRoll(identity.userId));
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
        source: registration ? "registered" : "lookup",
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

// Liveness check. It is mounted after the global API limiter, so it shares
// that 600/15min budget rather than being an unrated bypass.
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
        // warm the anonymous payload only: names stay behind identity
        await cacheLeaderboard(
          leaderboardCacheKey(query, false),
          await buildLeaderboardPayload(query, false),
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

interface StatusComponentBase {
  component: string;
  uptimePct: number;
  pings: number;
  lastPing: string;
  lastStatus: string;
  avgLatencyMs: number | null;
  buckets: Awaited<ReturnType<typeof getUptimeDailyBuckets>>;
}

let statusCache: { at: number; components: StatusComponentBase[] } | null =
  null;

const computeStatusComponents = async (): Promise<StatusComponentBase[]> => {
  const summary = await getUptimeSummary();
  return Promise.all(
    summary.map(async (s) => ({
      component: s.component,
      uptimePct: s.uptimePct,
      pings: s.pings,
      lastPing: s.lastPing,
      lastStatus: s.lastStatus,
      avgLatencyMs: s.avgLatencyMs,
      buckets: await getUptimeDailyBuckets(s.component, 90),
    })),
  );
};

/**
 * Derives "current"/"stale" at read time. The summary and 90-day buckets are
 * cacheable for five minutes, but a heartbeat crossing the 15-minute stale
 * line must not keep showing "Operational" until that cache expires.
 */
const withStatusFreshness = (components: StatusComponentBase[]) =>
  components.map((c) => {
    const lastPingAgeSec = Math.floor(
      (Date.now() - new Date(c.lastPing + "Z").getTime()) / 1000,
    );
    // up = the newest heartbeat said up, and it is recent. A down probe also
    // writes a heartbeat, so age alone would report an outage as "up". stale
    // separates "the service is down" from "the monitor stopped reporting".
    const stale = lastPingAgeSec >= 15 * 60;
    const current: "up" | "down" =
      c.lastStatus === "up" && !stale ? "up" : "down";
    return {
      component: c.component,
      uptimePct: c.uptimePct,
      pings: c.pings,
      lastPing: c.lastPing,
      lastPingAgeSec,
      avgLatencyMs: c.avgLatencyMs,
      current,
      stale,
      buckets: c.buckets,
    };
  });

app.get("/api/status", securityLogger, async (_req: Request, res: Response) => {
  try {
    let components: StatusComponentBase[];
    if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) {
      components = statusCache.components;
    } else {
      components = await computeStatusComponents();
      statusCache = { at: Date.now(), components };
    }

    res.type("json").send(
      JSON.stringify({
        success: true,
        components: withStatusFreshness(components),
      }),
    );
  } catch (error) {
    logger.error("Error in /api/status:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export const startServer = () => {
  // Bind loopback by default: nginx owns the public interface and proxies to
  // this process, so the API itself must not be reachable directly.
  const port = Number(PORT) || 3000;
  const server = app.listen(port, HOST, () => {
    logger.info(
      `🚀 API Server listening on ${HOST}:${port} with security enabled`,
    );
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
