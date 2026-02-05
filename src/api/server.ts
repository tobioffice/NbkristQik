import express, { Request, Response } from "express";
import cors from "cors";
import { getLeaderboard } from "../db/student_stats.model.js";
import {
  leaderboardSecurityMiddlewares,
  apiSecurityMiddlewares,
  securityLogger,
} from "../middleware/security.js";
import {
  generateLeaderboardCacheKey,
  getLeaderboardCache,
  setLeaderboardCache,
  getCacheAnalytics,
} from "../services/redis/leaderboardCache.js";
import { logger } from "../utils/logger.js";

const app = express();
const PORT = process.env.PORT || 3000;

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
    const startTime = Date.now();

    try {
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
      };

      // Generate cache key
      const cacheKey = generateLeaderboardCacheKey(sortBy, page, limit, filters);

      // Try to get from cache
      const cached = await getLeaderboardCache(cacheKey, sortBy, filters);

      if (cached) {
        const duration = Date.now() - startTime;
        logger.perf("Leaderboard served from cache", duration, { cacheKey });
        
        return res.json({
          success: true,
          page,
          limit,
          data: cached,
          cached: true,
          responseTime: duration,
        });
      }

      // Cache miss - fetch from database
      const offset = (page - 1) * limit;
      const data = await getLeaderboard(sortBy, limit, offset, filters);

      // Store in cache
      await setLeaderboardCache(cacheKey, data, sortBy, filters);

      const duration = Date.now() - startTime;
      logger.perf("Leaderboard served from DB", duration, { cacheKey });

      res.json({
        success: true,
        page,
        limit,
        data,
        cached: false,
        responseTime: duration,
      });
    } catch (error) {
      logger.error("Error fetching leaderboard", error);
      res.status(500).json({ success: false, error: "Internal Server Error" });
    }
  },
);

// Cache analytics endpoint (for monitoring)
app.get("/api/cache/analytics", securityLogger, async (_req: Request, res: Response) => {
  try {
    const analytics = await getCacheAnalytics();
    
    res.json({
      success: true,
      analytics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error fetching cache analytics", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Health check endpoint (no rate limiting)
app.get("/health", securityLogger, (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: "1.0.0",
  });
});

export const startServer = () => {
  app.listen(PORT, () => {
    logger.info(`🚀 API Server running on port ${PORT} with security enabled`);
  });
};
