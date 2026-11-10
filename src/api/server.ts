import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { existsSync } from "fs";
import path from "path";
import {
  getLeaderboard,
  getLeaderboardFacets,
  getLeaderboardCoverage,
  getLastSyncAt,
  getStudentRank,
  getUptimeSummary,
  getUptimeDailyBuckets,
} from "../db/student_stats.model.js";
import { deleteTgUser, getTgUserRoll } from "../db/student.model.js";
import { getRegistration } from "../db/registration.model.js";
import { getStudentCached } from "../services/redis/utils.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys } from "../services/redis/keys.js";
import { attachedIdentity, type Identity } from "./resolveUser.js";
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
  identityRateLimitKey,
  librarySessionRateLimitKey,
} from "../middleware/security.js";
import { PORT, HOST, CORS_ORIGINS } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import { isEmbeddedDatabase } from "../db/db.js";
import { registerAdminRoutes } from "./admin/index.js";
import { profileRouter } from "./profile.js";
import { reportRouter } from "./report.js";
import { libraryRouter } from "./library.js";
import { readSessionFromCookies } from "../services/library/session.js";
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
        // The SDK is a fixed, vendored file; the ?v= in app.html changes when
        // its rev changes, so this one can be cached for good.
        const isTelegramSdk =
          requestPath.endsWith("telegram-web-app.js") ||
          filePath.endsWith(`${path.sep}telegram-web-app.js`);
        if (isAsset || isTelegramSdk) {
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

/**
 * Per-caller responses must not be replayed by a shared cache or a heuristic
 * browser cache. `/api/me` and the academics endpoint set their own policy in
 * the handler (the academics success response may be cached for 60 s).
 */
const privateNoStore = (_req: Request, res: Response, next: NextFunction) => {
  res.set("Cache-Control", "private, no-store");
  next();
};

app.use("/api/profile", privateNoStore);
app.use("/api/myreports", privateNoStore);
app.use("/api/thread", privateNoStore);

// Private endpoints for the external uptime monitor on oracle2. Hidden
// unless UPTIME_INGEST_SECRET is configured.
registerInternalRoutes(app);

// Profile/registration endpoints: identity-authenticated, writes rate-limited
// harder than the global limit (bot-side flows are the intended entry).
const profileWriteLimit = createRateLimit(
  15 * 60 * 1000,
  20,
  "Too many profile updates, please try again later.",
  identityRateLimitKey,
);
app.use("/api/register", profileWriteLimit);
app.use("/api", profileRouter);

// Report endpoints: identity-authenticated; submits rate-limited per account
// and further throttled per user in the service (60 s gate, fail-open).
const reportWriteLimit = createRateLimit(
  15 * 60 * 1000,
  5,
  "Too many reports, please try again later.",
  identityRateLimitKey,
);
app.use("/api/report", reportWriteLimit);

// Report threads: reads and follow-up messages are conversation-paced, so
// they get a roomier per-account limit on top of the per-user 3 s gate in the
// service. Mounted before the report router for clarity; `/api/report` above
// never matches `/api/thread`.
const threadLimit = createRateLimit(
  15 * 60 * 1000,
  120,
  "Too many thread requests, please try again later.",
  identityRateLimitKey,
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
  librarySessionRateLimitKey,
);
app.use("/api/library/session", librarySessionLimit);
app.use("/api/library", libraryRouter);

interface LeaderboardFilters {
  year?: string;
  branch?: string;
  section?: string;
  search?: string;
}

type LeaderboardScopeMode = "me" | "all";

interface LeaderboardScope {
  year: string | null;
  branch: string | null;
  section: string | null;
}

interface LeaderboardQuery {
  page: number;
  limit: number;
  sortBy: "attendance" | "midmarks";
  /** `me` is the default; `all` is a deliberate whole-college request. */
  scopeMode: LeaderboardScopeMode;
  /** True when the client set at least one of year/branch/section. */
  explicitScopeFilter: boolean;
  /** The effective section context, or null for a whole-college page. */
  scope: LeaderboardScope | null;
  filters: LeaderboardFilters;
}

/**
 * The UI sends a year digit (1..4); older links may still carry the portal's
 * year-semester code (11/21/31/41, or a stale 12). Both resolve to the leading
 * digit, which is what the SQL filters on. `all` (or unparseable input) means
 * no filter rather than an empty page.
 */
const normalizeYearFilter = (value: unknown): string | undefined => {
  if (value == null || value === "all") return undefined;
  const match = String(value)
    .trim()
    .match(/^([1-4])/);
  return match ? match[1] : undefined;
};

const parseLeaderboardQuery = (
  req: Request,
  identity: Identity,
): LeaderboardQuery => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const sortBy = (req.query.sort as "attendance" | "midmarks") || "attendance";

  // Presence, not value: `branch=all` is an explicit "whole branch" choice
  // and must override the caller's own branch, not silently re-apply it.
  const explicitScopeFilter =
    req.query.year != null ||
    req.query.branch != null ||
    req.query.section != null;

  // `me` is the default only for a caller who can actually have a saved roll.
  // An anonymous request defaults to `all`, which is also the mode the warm
  // cache writes; otherwise the warm key would never be read.
  const requestedScope = req.query.scope;
  const scopeMode: LeaderboardScopeMode =
    requestedScope === "all"
      ? "all"
      : requestedScope === "me"
        ? "me"
        : identity.status === "authenticated"
          ? "me"
          : "all";

  const filters = {
    year: normalizeYearFilter(req.query.year),
    branch:
      req.query.branch === "all" ? undefined : (req.query.branch as string),
    section:
      req.query.section === "all" ? undefined : (req.query.section as string),
    search: req.query.search
      ? String(req.query.search).trim().slice(0, 20)
      : undefined,
  };

  return {
    page,
    limit,
    sortBy,
    scopeMode,
    explicitScopeFilter,
    scope: null,
    filters,
  };
};

/** The page's effective section context, or null when no filter is set. */
const scopeFromFilters = (
  filters: LeaderboardFilters,
): LeaderboardScope | null => {
  if (!filters.year && !filters.branch && !filters.section) return null;
  return {
    year: filters.year ?? null,
    branch: filters.branch ?? null,
    section: filters.section ?? null,
  };
};

/**
 * Resolve the caller's own section from their *registration* and master row.
 * tgusers is the last looked-up roll (often a friend's), so it is never used
 * to decide what "my section" means. Failures fall back to the explicit
 * filters rather than failing the leaderboard.
 */
const resolveCallerScope = async (
  userId: string,
): Promise<LeaderboardScope | null> => {
  try {
    const registration = await getRegistration(userId);
    if (!registration) return null;

    const student = await getStudentCached(registration.roll_no);
    const year = normalizeYearFilter(student.year);
    if (!year) return null;

    return {
      year,
      branch: student.branch ? String(student.branch) : null,
      section: student.section ? String(student.section) : null,
    };
  } catch (e) {
    logger.debug("[API] leaderboard scope lookup failed:", e);
    return null;
  }
};

/**
 * Apply `scope=me` only when the caller has a registration *and* did not
 * choose a filter explicitly. An explicit filter (including `all`) always
 * wins; `scope=all` never applies the caller's section.
 */
const applyLeaderboardScope = async (
  query: LeaderboardQuery,
  identity: Identity,
): Promise<void> => {
  if (
    query.scopeMode === "me" &&
    !query.explicitScopeFilter &&
    identity.status === "authenticated"
  ) {
    query.scope = await resolveCallerScope(identity.userId);
    if (query.scope) {
      query.filters = {
        ...query.filters,
        year: query.scope.year ?? undefined,
        branch: query.scope.branch ?? undefined,
        section: query.scope.section ?? undefined,
      };
      return;
    }
  }

  query.scope = scopeFromFilters(query.filters);
};

/**
 * Cache key. The `names`/`anon` segment is security-critical: a cached
 * identified page carries names and must never be served to an anonymous
 * caller (or vice versa: an empty anonymous page must not hide names from a
 * signed-in student on the next request).
 *
 * The scope mode and the resolved year:branch:section are correctness-
 * critical: two callers using `scope=me` from different sections must never
 * share a cached page, even if a filter resolution fails or a warm job writes
 * a similarly shaped key.
 */
const leaderboardCacheKey = (
  q: LeaderboardQuery,
  includeNames: boolean,
): string => {
  const scopeKey = q.scope
    ? `${q.scope.year ?? ""}:${q.scope.branch ?? ""}:${q.scope.section ?? ""}`
    : "-";
  return redisKeys.leaderboard(
    `${includeNames ? "names" : "anon"}:${q.scopeMode}:${scopeKey}:${q.sortBy}:${q.page}:${q.limit}:${q.filters.year || "all"}:${q.filters.branch || "all"}:${q.filters.section || "all"}:${q.filters.search || ""}`,
  );
};

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

  // Freshness, the live section list and coverage belong to the first page
  // only; later pages already have them, and each extra query costs Turso
  // reads. A search has no denominator, so its coverage is null.
  const asOf =
    query.page === 1
      ? await Promise.all([
          getLastSyncAt(query.sortBy),
          getLeaderboardFacets(query.filters),
          query.filters.search
            ? Promise.resolve(null)
            : getLeaderboardCoverage(query.filters),
        ])
      : null;

  const known = asOf ? asOf[2] : null;

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
    updated_at: asOf ? asOf[0].newest : null,
    // Keep updated_at = newest for one release (older clients read it); the
    // range is additive so the UI can say "newest 2 min ago, oldest 6 days".
    freshness: asOf ? asOf[0] : null,
    facets: asOf ? { sections: asOf[1] } : null,
    scope: query.scope,
    // `ranked` is how many students the register actually has for this view;
    // `known` is the directory count for the same filters. Never present
    // ranked as the whole college.
    coverage: asOf && known != null ? { ranked: total, known } : null,
  };
};

// API Routes
app.get(
  "/api/leaderboard",
  leaderboardSecurityMiddlewares,
  async (req: Request, res: Response) => {
    try {
      const identity = attachedIdentity(req, res);
      if (identity.status === "invalid") {
        // A presented-but-bad signature is never downgraded to anonymous:
        // that would let a broken client silently change what it sees.
        res.status(401).json({ success: false, error: identity.error });
        return;
      }

      const identified = identity.status === "authenticated";
      const query = parseLeaderboardQuery(req, identity);
      await applyLeaderboardScope(query, identity);
      const cacheKey = leaderboardCacheKey(query, identified);

      // Identified payloads carry names, so they go to one browser only;
      // anonymous payloads are identical for everyone and may be shared. The
      // response varies on the identity header either way, so a shared cache
      // cannot hand an identified page to an anonymous caller.
      res.vary("X-Telegram-Init-Data");
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
    const identity = attachedIdentity(req, res);
    if (identity.status === "invalid") {
      res.status(401).json({
        libraryOpen: false,
        admin: false,
        error: identity.error,
      });
      return;
    }

    const userId = identity.status === "authenticated" ? identity.userId : null;

    // A PC browser has the library cookie but no Telegram identity. The
    // session is what proves who it is, so the Library tab survives a reload.
    let sessionUserId: string | null = userId;
    if (!sessionUserId) {
      const session = await readSessionFromCookies(req.headers.cookie);
      sessionUserId = session?.session.userId ?? null;
    }

    res.set("Cache-Control", "no-store");
    res.json({
      libraryOpen: sessionUserId ? canOpenLibrary(sessionUserId) : false,
      admin: sessionUserId ? canPreviewEverything(sessionUserId) : false,
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
    res.set("Cache-Control", "private, no-store");
    try {
      const identity = attachedIdentity(req, res);
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

      // Identity is the registration, nothing else. tgusers is auto-upserted
      // by every lookup (including a friend's), so treating it as identity
      // made the app say "Reading as" the friend and show their rank.
      const registration = await getRegistration(identity.userId).catch(
        () => null,
      );
      if (!registration) {
        const lastLookup = await getTgUserRoll(identity.userId).catch(
          () => null,
        );
        res.json({ found: false, lastLookup });
        return;
      }

      const rollNo = registration.roll_no;
      const [attendance, midmarks] = await Promise.all([
        getStudentRank(rollNo, "attendance"),
        getStudentRank(rollNo, "midmarks"),
      ]);

      res.json({
        found: true,
        source: "registered",
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

/**
 * Forgets the caller's last-lookup roll. Requires a verified identity; the
 * registration (if any) is untouched. Useful when a friend's roll is stuck as
 * the profile suggestion.
 */
app.delete("/api/me/last-lookup", async (req: Request, res: Response) => {
  res.set("Cache-Control", "private, no-store");
  try {
    const identity = attachedIdentity(req, res);
    if (identity.status === "anonymous") {
      res.status(401).json({ ok: false, error: "Telegram initData required" });
      return;
    }
    if (identity.status === "invalid") {
      res.status(401).json({ ok: false, error: identity.error });
      return;
    }

    await deleteTgUser(identity.userId);
    res.json({ ok: true });
  } catch (error) {
    logger.error("Error deleting last lookup:", error);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

// Liveness check. It is mounted after the global API limiter, so it spends
// the caller's own 600/15min budget rather than being an unrated bypass.
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
  {
    page: 1,
    limit: 20,
    sortBy: "attendance",
    scopeMode: "all",
    explicitScopeFilter: false,
    scope: null,
    filters: {},
  },
  {
    page: 1,
    limit: 20,
    sortBy: "midmarks",
    scopeMode: "all",
    explicitScopeFilter: false,
    scope: null,
    filters: {},
  },
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

  // The warm loop is a Turso-era latency workaround. With the embedded file
  // the default query is local and cheap, so do not spend a query every 50 s
  // in the background. Remote deployments keep the original behaviour until
  // the cutover is verified.
  if (!isEmbeddedDatabase) {
    void warmLeaderboardCache();
    const warmTimer = setInterval(() => {
      void warmLeaderboardCache();
    }, 50_000);
    warmTimer.unref();
  } else {
    logger.info("[API] embedded database: leaderboard warm loop disabled");
  }
  return server;
};
