import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { existsSync } from "fs";
import path from "path";
import {
  getUptimeSummary,
  getUptimeDailyBuckets,
} from "../db/student_stats.model.js";
import { deleteTgUser } from "../db/student.model.js";
import { attachedIdentity } from "./resolveUser.js";
import {
  canOpenLibrary,
  canPreviewEverything,
} from "../services/library/access.js";
import {
  apiSecurityMiddlewares,
  securityLogger,
  createRateLimit,
  identityRateLimitKey,
  librarySessionRateLimitKey,
} from "../middleware/security.js";
import { PORT, HOST, CORS_ORIGINS } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
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

  return server;
};
