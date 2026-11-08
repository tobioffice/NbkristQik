import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  query,
  validationResult,
  FieldValidationError,
} from "express-validator";
import { logger } from "../config/logger.js";
import { ROLL_REGEX } from "../constants/index.js";
import { attachIdentity, type Identity } from "../api/resolveUser.js";

// Rate limiting configurations
//
// NOTE ON KEYS: the API limiter is per Telegram account when the caller
// proved an identity (attachIdentity runs first), and per network address for
// anonymous callers. A campus NAT puts many students behind one address, so a
// single per-IP budget let a few students scrolling the register lock out the
// rest. A generous per-IP backstop (10,000 / 15 min) still caps anonymous
// abuse without becoming the shared budget.
//
// IPv6 keys always go through express-rate-limit's `ipKeyGenerator`, which
// normalizes to a /56 subnet; a raw address would let one client rotate
// addresses to evade the backstop.
export const createRateLimit = (
  windowMs: number,
  max: number,
  message: string,
  keyGenerator?: (req: Request, res: Response) => string,
) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      error: message,
      retryAfter: Math.ceil(windowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
  });
};

/** The normalized transport address, never a raw IPv6 string. */
export const clientIpKey = (req: Request): string =>
  ipKeyGenerator(req.ip || req.socket?.remoteAddress || "unknown");

/**
 * Per-account budget when authenticated, per-address otherwise. The identity
 * is already on `res.locals`, so this never repeats the initData HMAC.
 */
export const identityRateLimitKey = (req: Request, res: Response): string => {
  const identity = res.locals?.identity as Identity | undefined;
  if (identity?.status === "authenticated" && identity.userId) {
    return `u:${identity.userId}`;
  }
  return `ip:${clientIpKey(req)}`;
};

const API_WINDOW_MS = 15 * 60 * 1000;
const API_USER_REQUESTS = 600; // ~40/min, comfortable for infinite scroll
const API_IP_BACKSTOP_REQUESTS = 10_000;

/**
 * Run a limiter at most once per request. `/api` and the leaderboard chain
 * both carry these limiters; without the flag a leaderboard request would
 * spend two tokens from the same budget and the route would be throttled at
 * half its documented rate.
 */
const chargeOnce = (flag: string, limiter: RequestHandler): RequestHandler => {
  return (req, res, next) => {
    const locals = res.locals as Record<string, unknown> | undefined;
    if (!locals) {
      limiter(req, res, next);
      return;
    }
    if (locals[flag]) {
      next();
      return;
    }
    locals[flag] = true;
    limiter(req, res, next);
  };
};

// General API protection: one student's scrolling cannot exhaust another
// student's budget, even when both sit behind the same campus NAT.
export const apiRateLimit = chargeOnce(
  "__apiUserRateLimited",
  createRateLimit(
    API_WINDOW_MS,
    API_USER_REQUESTS,
    "Too many API requests, please try again later.",
    identityRateLimitKey,
  ),
);

// Transport backstop: anonymous abuse is still capped per address, but high
// enough that a shared campus address is not a few students' bottleneck.
export const apiIpBackstop = chargeOnce(
  "__apiIpRateLimited",
  createRateLimit(
    API_WINDOW_MS,
    API_IP_BACKSTOP_REQUESTS,
    "Too many requests from this network, please try again later.",
    (req) => `ip:${clientIpKey(req)}`,
  ),
);

// API parameter validation for leaderboard
export const leaderboardValidation = [
  query("page")
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage("Page must be between 1 and 1000"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),

  query("sort")
    .optional()
    .isIn(["attendance", "midmarks"])
    .withMessage('Sort must be either "attendance" or "midmarks"'),

  query("year")
    .optional()
    .matches(/^(\d{1,2}|all)$/)
    .withMessage('Year must be a digit or "all"'),

  query("branch")
    .optional()
    .matches(/^(\d+|all)$/)
    .withMessage('Branch must be digits or "all"'),

  query("section")
    .optional()
    .matches(/^([A-Z]|all)$/i)
    .withMessage('Section must be a letter or "all"'),

  query("scope")
    .optional()
    .isIn(["me", "all"])
    .withMessage('Scope must be either "me" or "all"'),

  query("search")
    .optional()
    .isLength({ min: 2, max: 20 })
    .matches(/^[\w\s-]+$/)
    .withMessage("Search must be 2-20 letters, digits, spaces or dashes"),
];

// Input sanitization middleware
// Only req.body is mutated: under Express 5 req.query/req.params come from
// getters, so in-place edits there are unreliable. Query input is already
// constrained by the allowlist validators above.
export const sanitizeInput = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const sanitizeObject = (obj: object) => {
    for (const key in obj) {
      const value = (obj as Record<string, unknown>)[key];
      if (typeof value === "string") {
        // Store the student's words; every render path escapes on output
        // (React text nodes, Telegram escapeHtml, admin esc()). Stripping
        // angle brackets here mangles reports that quote HTML and corrupts a
        // legacy initData body containing a name with "<".
        (obj as Record<string, unknown>)[key] = value.trim();
      } else if (typeof value === "object" && value !== null) {
        sanitizeObject(value as object);
      }
    }
  };

  if (req.body) sanitizeObject(req.body);

  next();
};

// Validation error handler
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: "Validation failed",
      details: errors.array().map((err) => {
        const fieldErr = err as FieldValidationError;
        return {
          field: fieldErr.path,
          message: fieldErr.msg,
          value: fieldErr.value,
        };
      }),
    });
    return;
  }
  next();
};

// Security logging middleware
const requestMeta = (req: Request) => ({
  timestamp: new Date().toISOString(),
  ip: req.ip || req.socket.remoteAddress,
  userAgent: req.get("User-Agent") || "Unknown",
  method: req.method,
  url: req.url,
});

// Log suspicious patterns: traversal, XSS, SQL injection, code injection
const SUSPICIOUS_PATTERNS = [/\.\./, /<script/i, /union.*select/i, /eval\(/i];

const isSuspiciousRequest = (req: Request): boolean => {
  const requestData = JSON.stringify({ body: req.body, query: req.query });
  return SUSPICIOUS_PATTERNS.some(
    (pattern) => pattern.test(requestData) || pattern.test(req.url),
  );
};

export const securityLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (isSuspiciousRequest(req)) {
    const requestData = JSON.stringify({ body: req.body, query: req.query });
    logger.warn(`🚨 [SECURITY] Suspicious request detected:`, {
      ...requestMeta(req),
      requestData: requestData.substring(0, 200) + "...",
    });
  }

  // Log rate limit hits
  res.on("finish", () => {
    if (res.statusCode === 429) {
      logger.warn(`🚫 [RATE LIMIT] Request blocked:`, requestMeta(req));
    }
  });

  next();
};

// Roll number format validator (shared with the bot's ROLL_REGEX)
export const isValidRollNumber = (rollNumber: string): boolean => {
  return ROLL_REGEX.test(rollNumber.toUpperCase().trim());
};

/**
 * O/0 confusion fix: no real roll contains the letter O (verified against
 * the full college master table), so a typed O is always meant to be 0.
 */
export const normalizeRollNumber = (rollNumber: string): string =>
  rollNumber.toUpperCase().trim().replace(/O/g, "0");

// Bot-specific security middleware
const pruneStaleEntries = (
  counts: Map<number, { count: number; resetTime: number }>,
  now: number,
) => {
  if (counts.size <= 5000) return;
  for (const [id, entry] of counts) {
    if (now > entry.resetTime) counts.delete(id);
  }
};

export const createBotSecurityHandler = () => {
  const userRequestCounts = new Map<
    number,
    { count: number; resetTime: number }
  >();

  const WINDOW_MS = 60 * 1000; // 1 minute
  const MAX_REQUESTS = 10; // 10 requests per minute

  return async (
    userId: number,
    action: string = "message",
  ): Promise<boolean> => {
    try {
      const now = Date.now();
      pruneStaleEntries(userRequestCounts, now);

      const userData = userRequestCounts.get(userId);

      if (!userData || now > userData.resetTime) {
        // First request or window expired
        userRequestCounts.set(userId, {
          count: 1,
          resetTime: now + WINDOW_MS,
        });
        return true;
      }

      if (userData.count >= MAX_REQUESTS) {
        logger.warn(
          `🚫 [BOT SECURITY] User ${userId} exceeded rate limit for ${action}`,
        );
        return false;
      }

      userData.count++;
      return true;
    } catch (error) {
      logger.error("Bot security handler error:", error);
      return true; // Allow request if security check fails
    }
  };
};

// Export singleton instance
export const botSecurityHandler = createBotSecurityHandler();

// Export combined middlewares for easy use. Identity runs before the
// limiters so the limiter can key on the account; the `chargeOnce` wrappers
// keep a route that carries both chains from spending two tokens.
export const apiSecurityMiddlewares = [
  securityLogger,
  sanitizeInput,
  attachIdentity,
  apiRateLimit,
  apiIpBackstop,
];

export const leaderboardSecurityMiddlewares = [
  attachIdentity,
  apiRateLimit,
  apiIpBackstop,
  ...leaderboardValidation,
  handleValidationErrors,
];
