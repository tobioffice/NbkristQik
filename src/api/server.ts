import express, { Request, Response } from "express";
import cors from "cors";
import {
  getLeaderboard,
  getStudentRank,
  initLeaderboardIndexes,
} from "../db/student_stats.model.js";
import { getTgUserRoll } from "../db/student.model.js";
import { getClient } from "../services/redis/getRedisClient.js";
import {
  getUptimeSummary,
  getUptimeDailyBuckets,
} from "../db/student_stats.model.js";
import {
  leaderboardSecurityMiddlewares,
  apiSecurityMiddlewares,
  securityLogger,
} from "../middleware/security.js";

export const app = express();
const PORT = process.env.PORT || 3000;

// Behind nginx on oracle3: trust the single proxy hop so req.ip and
// express-rate-limit see the real client IP, not 127.0.0.1.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: ["https://tobioffice.github.io"],
  }),
);

// app.use(cors());

app.use(express.json());

// Apply security middleware to all routes
app.use(apiSecurityMiddlewares);

// API Routes
app.get(
  "/api/leaderboard",
  leaderboardSecurityMiddlewares,
  async (req: Request, res: Response) => {
    try {
      // const userId = req.query.userId
      //    ? parseInt(req.query.userId as string)
      //    : null;

      // console.log("User ID:", userId);
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const sortBy =
        (req.query.sort as "attendance" | "midmarks") || "attendance";

      const filters = {
        year: req.query.year === "all" ? undefined : (req.query.year as string),
        branch:
          req.query.branch === "all" ? undefined : (req.query.branch as string),
        section:
          req.query.section === "all"
            ? undefined
            : (req.query.section as string),
        search: req.query.search
          ? String(req.query.search).trim().slice(0, 20)
          : undefined,
      };

      const offset = (page - 1) * limit;

      // 60s Redis cache per unique query — protects Turso read quota
      const cacheKey = `lb:${sortBy}:${page}:${limit}:${filters.year || "all"}:${filters.branch || "all"}:${filters.section || "all"}:${filters.search || ""}`;
      try {
        const cached = await getClient().then((c) => c.get(cacheKey));
        if (cached) {
          res.json(JSON.parse(cached));
          return;
        }
      } catch (e) {
        console.warn("[API] leaderboard cache read failed:", e);
      }

      const { rows, total } = await getLeaderboard(sortBy, limit, offset, filters);

      const payload = {
        success: true,
        page,
        limit,
        total,
        data: rows,
      };

      // cache for 60 seconds (best-effort)
      try {
        await getClient().then((c) =>
          c.set(cacheKey, JSON.stringify(payload), { EX: 60 })
        );
      } catch (e) {
        console.warn("[API] leaderboard cache write failed:", e);
      }

      res.json(payload);
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      res.status(500).json({ success: false, error: "Internal Server Error" });
    }
  },
);

// "You are #N" — rank lookup for the web leaderboard via tgusers mapping
app.get(
  "/api/me",
  leaderboardSecurityMiddlewares,
  async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      if (!userId || !/^\d{1,20}$/.test(userId)) {
        res.status(400).json({ found: false, error: "userId required" });
        return;
      }

      const rollNo = await getTgUserRoll(userId);
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
          ? { rank: attendance.rank, total: attendance.total }
          : null,
        midmarks: midmarks
          ? { rank: midmarks.rank, total: midmarks.total }
          : null,
      });
    } catch (error) {
      console.error("Error fetching /api/me:", error);
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

// Pro status page — 90-day uptime summary + daily bars
app.get("/api/status", securityLogger, async (_req: Request, res: Response) => {
  try {
    const summary = await getUptimeSummary();
    const components = await Promise.all(
      summary.map(async (s) => {
        const lastPingAgeSec = Math.floor(
          (Date.now() - new Date(s.lastPing + "Z").getTime()) / 1000
        );
        // up = last ping < 15 min ago
        const current: "up" | "down" = lastPingAgeSec < 15 * 60 ? "up" : "down";
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
      })
    );

    res.json({ success: true, components });
  } catch (error) {
    console.error("Error in /api/status:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export const startServer = () => {
  initLeaderboardIndexes().catch((e) =>
    console.warn("[API] leaderboard index init failed:", e),
  );
  app.listen(PORT, () => {
    console.log(`🚀 API Server running on port ${PORT} with security enabled`);
  });
};
