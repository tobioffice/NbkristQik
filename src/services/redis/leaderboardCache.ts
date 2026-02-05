import { getClient } from "../services/redis/getRedisClient.js";
import crypto from "crypto";
import { logger } from "../utils/logger.js";

/**
 * Advanced Redis cache controller for leaderboard optimization
 * Implements smart TTL, multi-level caching, and analytics tracking
 */

// Cache TTL configuration (in seconds)
const CACHE_TTL = {
  HOT: 300,    // 5 minutes - Most accessed queries
  WARM: 1800,  // 30 minutes - Regular queries
  COLD: 3600,  // 1 hour - Rarely accessed queries
};

// Analytics tracking for cache hit/miss
interface CacheAnalytics {
  key: string;
  hits: number;
  misses: number;
  lastAccess: number;
}

/**
 * Generate deterministic cache key for leaderboard query
 */
export function generateLeaderboardCacheKey(
  sortBy: "attendance" | "midmarks",
  page: number,
  limit: number,
  filters: {
    year?: string;
    branch?: string;
    section?: string;
  }
): string {
  // Normalize filters to ensure consistent keys
  const normalizedFilters = {
    year: filters.year || "all",
    branch: filters.branch || "all",
    section: filters.section || "all",
  };

  // Create deterministic key
  const keyParts = [
    sortBy,
    page.toString(),
    limit.toString(),
    normalizedFilters.year,
    normalizedFilters.branch,
    normalizedFilters.section,
  ];

  return `leaderboard:${keyParts.join(":")}`;
}

/**
 * Generate hash for query pattern (used for analytics)
 */
function generateQueryPattern(
  sortBy: "attendance" | "midmarks",
  filters: {
    year?: string;
    branch?: string;
    section?: string;
  }
): string {
  const normalizedFilters = {
    year: filters.year || "all",
    branch: filters.branch || "all",
    section: filters.section || "all",
  };

  return `pattern:${sortBy}:${normalizedFilters.year}:${normalizedFilters.branch}:${normalizedFilters.section}`;
}

/**
 * Get cache with analytics tracking
 */
export async function getLeaderboardCache(
  cacheKey: string,
  sortBy: "attendance" | "midmarks",
  filters: any
): Promise<any | null> {
  try {
    const redis = await getClient();
    const cached = await redis.get(cacheKey);

    const pattern = generateQueryPattern(sortBy, filters);

    if (cached) {
      // Track cache hit
      await trackCacheHit(pattern, cacheKey);
      logger.debug("Cache HIT", { cacheKey, pattern });
      return JSON.parse(cached);
    } else {
      // Track cache miss
      await trackCacheMiss(pattern, cacheKey);
      logger.debug("Cache MISS", { cacheKey, pattern });
      return null;
    }
  } catch (error) {
    logger.error("Cache read error", error, { cacheKey });
    return null; // Graceful degradation
  }
}

/**
 * Set cache with smart TTL based on query popularity
 */
export async function setLeaderboardCache(
  cacheKey: string,
  data: any,
  sortBy: "attendance" | "midmarks",
  filters: any
): Promise<void> {
  try {
    const redis = await getClient();
    const pattern = generateQueryPattern(sortBy, filters);

    // Determine TTL based on query popularity
    const ttl = await determineSmartTTL(pattern);

    await redis.setEx(cacheKey, ttl, JSON.stringify(data));
    logger.debug("Cache SET", { cacheKey, ttl, pattern });
  } catch (error) {
    logger.error("Cache write error", error, { cacheKey });
    // Don't throw - caching failure shouldn't break the app
  }
}

/**
 * Smart TTL determination based on query popularity
 * Hot queries (high access) get shorter TTL for freshness
 * Cold queries (low access) get longer TTL to reduce DB load
 */
async function determineSmartTTL(pattern: string): Promise<number> {
  try {
    const redis = await getClient();
    const analyticsKey = `analytics:${pattern}`;
    const analytics = await redis.get(analyticsKey);

    if (!analytics) {
      return CACHE_TTL.WARM; // Default for new patterns
    }

    const parsed: CacheAnalytics = JSON.parse(analytics);
    const totalAccess = parsed.hits + parsed.misses;

    // Hot query (>100 accesses in last hour) = shorter TTL for freshness
    if (totalAccess > 100) {
      return CACHE_TTL.HOT;
    }

    // Cold query (<10 accesses) = longer TTL to reduce DB load
    if (totalAccess < 10) {
      return CACHE_TTL.COLD;
    }

    // Warm query = medium TTL
    return CACHE_TTL.WARM;
  } catch (error) {
    logger.error("Smart TTL determination error", error, { pattern });
    return CACHE_TTL.WARM; // Fallback
  }
}

/**
 * Track cache hit for analytics
 */
async function trackCacheHit(pattern: string, cacheKey: string): Promise<void> {
  try {
    const redis = await getClient();
    const analyticsKey = `analytics:${pattern}`;
    const existing = await redis.get(analyticsKey);

    let analytics: CacheAnalytics;

    if (existing) {
      analytics = JSON.parse(existing);
      analytics.hits++;
      analytics.lastAccess = Date.now();
    } else {
      analytics = {
        key: pattern,
        hits: 1,
        misses: 0,
        lastAccess: Date.now(),
      };
    }

    // Store analytics for 1 hour
    await redis.setEx(analyticsKey, 3600, JSON.stringify(analytics));
  } catch (error) {
    logger.error("Cache hit tracking error", error, { pattern });
  }
}

/**
 * Track cache miss for analytics
 */
async function trackCacheMiss(pattern: string, cacheKey: string): Promise<void> {
  try {
    const redis = await getClient();
    const analyticsKey = `analytics:${pattern}`;
    const existing = await redis.get(analyticsKey);

    let analytics: CacheAnalytics;

    if (existing) {
      analytics = JSON.parse(existing);
      analytics.misses++;
      analytics.lastAccess = Date.now();
    } else {
      analytics = {
        key: pattern,
        hits: 0,
        misses: 1,
        lastAccess: Date.now(),
      };
    }

    // Store analytics for 1 hour
    await redis.setEx(analyticsKey, 3600, JSON.stringify(analytics));
  } catch (error) {
    logger.error("Cache miss tracking error", error, { pattern });
  }
}

/**
 * Invalidate leaderboard cache (for data updates)
 */
export async function invalidateLeaderboardCache(
  sortBy?: "attendance" | "midmarks",
  filters?: {
    year?: string;
    branch?: string;
    section?: string;
  }
): Promise<void> {
  try {
    const redis = await getClient();

    if (!sortBy && !filters) {
      // Invalidate ALL leaderboard caches
      const keys = await redis.keys("leaderboard:*");
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.info("Invalidated ALL leaderboard caches", { count: keys.length });
      }
      return;
    }

    // Pattern-based invalidation
    let pattern = "leaderboard:";
    if (sortBy) pattern += `${sortBy}:`;
    else pattern += "*:";

    pattern += "*"; // Match all pages and filters

    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.info("Invalidated leaderboard caches", { pattern, count: keys.length });
    }
  } catch (error) {
    logger.error("Cache invalidation error", error, { sortBy, filters });
  }
}

/**
 * Get cache analytics for monitoring
 */
export async function getCacheAnalytics(): Promise<CacheAnalytics[]> {
  try {
    const redis = await getClient();
    const keys = await redis.keys("analytics:pattern:*");

    const analytics: CacheAnalytics[] = [];

    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        analytics.push(JSON.parse(data));
      }
    }

    // Sort by total access (hits + misses) descending
    return analytics.sort((a, b) => {
      const totalA = a.hits + a.misses;
      const totalB = b.hits + b.misses;
      return totalB - totalA;
    });
  } catch (error) {
    logger.error("Failed to fetch cache analytics", error);
    return [];
  }
}
