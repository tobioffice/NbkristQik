import rateLimit from "express-rate-limit";
import {
  body,
  query,
  validationResult,
  FieldValidationError,
} from "express-validator";

// Rate limiting configurations
export const createRateLimit = (
  windowMs: number,
  max: number,
  message: string,
  keyGenerator?: (req: any) => string,
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
    keyGenerator: keyGenerator || undefined,
    skip: (_req) => {
      // Skip rate limiting for admin requests (can be extended)
      return false;
    },
  });
};

// API rate limiting - General API protection
export const apiRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests per window
  "Too many API requests, please try again later.",
);

// Strict API rate limiting - For sensitive endpoints
export const strictApiRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  20, // 20 requests per window
  "Too many requests to this endpoint, please try again later.",
);

// Bot rate limiting - Track user requests to prevent spam
export const botRateLimit = createRateLimit(
  60 * 1000, // 1 minute
  10, // 10 requests per minute
  "Too many bot requests, please slow down.",
  (req) => req.body?.message?.from?.id?.toString() || "unknown",
);

// Roll number validation
export const rollNumberValidation = [
  body("rollNumber")
    .optional()
    .matches(/^\d{2}[a-zA-Z]{2}[a-zA-Z0-9]{6}$/)
    .withMessage("Invalid roll number format"),

  query("rollNumber")
    .optional()
    .matches(/^\d{2}[a-zA-Z]{2}[a-zA-Z0-9]{6}$/)
    .withMessage("Invalid roll number format"),
];

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
    .matches(/^(\d|all)$/)
    .withMessage('Year must be a digit or "all"'),

  query("branch")
    .optional()
    .matches(/^(\d+|all)$/)
    .withMessage('Branch must be digits or "all"'),

  query("section")
    .optional()
    .matches(/^([A-Z]|all)$/i)
    .withMessage('Section must be a letter or "all"'),
];

// Input sanitization middleware
export const sanitizeInput = (req: any, _res: any, next: any) => {
  // Sanitize strings in request body, query, and params
  const sanitizeObject = (obj: any) => {
    for (const key in obj) {
      if (typeof obj[key] === "string") {
        // Remove potential XSS characters by stripping angle brackets
        obj[key] = obj[key].replace(/[<>]/g, "").trim();
      } else if (typeof obj[key] === "object" && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  };

  if (req.body) sanitizeObject(req.body);
  if (req.query) sanitizeObject(req.query);
  if (req.params) sanitizeObject(req.params);

  next();
};

// Validation error handler
export const handleValidationErrors = (req: any, res: any, next: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
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
  }
  next();
};

// Security logging middleware
export const securityLogger = async (req: any, res: any, next: any) => {
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get("User-Agent") || "Unknown";
  const method = req.method;
  const url = req.url;

  // Log suspicious patterns
  const suspiciousPatterns = [
    /\.\./, // Directory traversal
    /<script/i, // XSS attempts
    /union.*select/i, // SQL injection attempts
    /eval\(/i, // Code injection
  ];

  const requestData = JSON.stringify({
    body: req.body,
    query: req.query,
    params: req.params,
  });

  const isSuspicious = suspiciousPatterns.some(
    (pattern) => pattern.test(requestData) || pattern.test(url),
  );

  if (isSuspicious) {
    console.warn(`🚨 [SECURITY] Suspicious request detected:`, {
      timestamp,
      ip,
      method,
      url,
      userAgent,
      requestData: requestData.substring(0, 200) + "...",
    });

    // Could implement IP blocking here in the future
  }

  // Log rate limit hits
  res.on("finish", () => {
    if (res.statusCode === 429) {
      console.warn(`🚫 [RATE LIMIT] Request blocked:`, {
        timestamp,
        ip,
        method,
        url,
        userAgent,
      });
    }
  });

  next();
};

// Roll number format validator (standalone function)
export const isValidRollNumber = (rollNumber: string): boolean => {
  const rollRegex = /^\d{2}[a-zA-Z0-9]{2}[a-zA-Z0-9]{6}$/;
  return rollRegex.test(rollNumber.toUpperCase().trim());
};

// Bot-specific security middleware
export const createBotSecurityHandler = () => {
  const userRequestCounts = new Map<
    number,
    { count: number; resetTime: number }
  >();

  return async (
    userId: number,
    action: string = "message",
  ): Promise<boolean> => {
    try {
      const now = Date.now();
      const windowMs = 60 * 1000; // 1 minute
      const maxRequests = 10; // 10 requests per minute

      const userData = userRequestCounts.get(userId);

      if (!userData || now > userData.resetTime) {
        // First request or window expired
        userRequestCounts.set(userId, {
          count: 1,
          resetTime: now + windowMs,
        });
        return true;
      }

      if (userData.count > maxRequests) {
        console.warn(
          `🚫 [BOT SECURITY] User ${userId} exceeded rate limit for ${action}`,
        );
        return false;
      }

      userData.count++;
      return true;
    } catch (error) {
      console.error("Bot security handler error:", error);
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
