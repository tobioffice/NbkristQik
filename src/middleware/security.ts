import rateLimit from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";
import {
  query,
  validationResult,
  FieldValidationError,
} from "express-validator";
import { logger } from "../config/logger.js";
import { ROLL_REGEX } from "../constants/index.js";

// Rate limiting configurations
export const createRateLimit = (
  windowMs: number,
  max: number,
  message: string,
  keyGenerator?: (req: Request) => string,
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
    // Use default IP-based key generator (handles IPv6 properly)
    keyGenerator,
  });
};

// API rate limiting - General API protection
export const apiRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  600, // 600 requests per window (~40/min, comfortable for infinite scroll)
  "Too many API requests, please try again later.",
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
        // Remove potential XSS characters by stripping angle brackets
        (obj as Record<string, unknown>)[key] = value
          .replace(/[<>]/g, "")
          .trim();
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

// Export combined middlewares for easy use
export const apiSecurityMiddlewares = [
  securityLogger,
  sanitizeInput,
  apiRateLimit,
];

export const leaderboardSecurityMiddlewares = [
  securityLogger,
  sanitizeInput,
  apiRateLimit,
  ...leaderboardValidation,
  handleValidationErrors,
];
