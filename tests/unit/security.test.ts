import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";
import {
  isValidRollNumber,
  normalizeRollNumber,
  createRateLimit,
  createBotSecurityHandler,
  botSecurityHandler,
  clientIpKey,
  identityRateLimitKey,
  sanitizeInput,
} from "../../src/middleware/security.js";

describe("Security Middleware", () => {
  describe("isValidRollNumber", () => {
    it("should validate correct roll number format", () => {
      // Using a roll number that matches the regex: 2 digits + 2 letters + 6 alphanumeric
      expect(isValidRollNumber("21B8AA05E9")).toBe(true);
      expect(isValidRollNumber("22C9BB12F3")).toBe(true);
      expect(isValidRollNumber("21b8aa05e9")).toBe(true); // case insensitive
    });

    it("should reject invalid roll number formats", () => {
      expect(isValidRollNumber("123456789")).toBe(false);
      expect(isValidRollNumber("21B81A05")).toBe(false); // too short
      expect(isValidRollNumber("21B81A05E90")).toBe(false); // too long
      expect(isValidRollNumber("ABC123")).toBe(false); // wrong format
      expect(isValidRollNumber("")).toBe(false);
    });

    it("should handle edge cases", () => {
      expect(isValidRollNumber("  21B8AA05E9  ")).toBe(true); // trimmed
      expect(isValidRollNumber("21B8AA05E9!")).toBe(false); // special chars
    });
  });

  describe("normalizeRollNumber", () => {
    it("turns a typed letter O into 0", () => {
      expect(normalizeRollNumber("25KB1AO5AR")).toBe("25KB1A05AR");
      expect(normalizeRollNumber("25kb1ao5ar")).toBe("25KB1A05AR");
      expect(normalizeRollNumber("2O0B1AO5AR")).toBe("200B1A05AR");
    });

    it("leaves clean rolls untouched", () => {
      expect(normalizeRollNumber("23KB1A0599")).toBe("23KB1A0599");
      expect(normalizeRollNumber("  23KB1A0599  ")).toBe("23KB1A0599");
    });

    it("makes O-typos pass validation", () => {
      expect(isValidRollNumber(normalizeRollNumber("25KB1AO5AR"))).toBe(true);
    });
  });

  describe("botSecurityHandler", () => {
    beforeEach(() => {
      // Reset rate limiting for tests
      vi.clearAllMocks();
    });

    it("should allow requests within rate limit", async () => {
      const userId = 12345;
      const allowed = await botSecurityHandler(userId, "message");
      expect(allowed).toBe(true);
    });

    it("should block excessive requests", async () => {
      const handler = createBotSecurityHandler();
      const userId = 99999;

      // Make 10 requests (should all be allowed)
      for (let i = 0; i < 10; i++) {
        const allowed = await handler(userId, "message");
        expect(allowed).toBe(true);
      }

      // 11th request should be blocked
      const blocked = await handler(userId, "message");
      expect(blocked).toBe(false);
    });
  });

  describe("createRateLimit", () => {
    it("should create rate limit middleware", () => {
      const limiter = createRateLimit(
        15 * 60 * 1000, // 15 minutes
        100, // 100 requests
        "Rate limit exceeded",
      );

      expect(limiter).toBeDefined();
      expect(typeof limiter).toBe("function");
    });
  });

  describe("rate limit keys", () => {
    const fakeRequest = (ip: string) =>
      ({ ip, socket: {} }) as unknown as Request;

    it("keys an authenticated caller by account", () => {
      const res = {
        locals: { identity: { status: "authenticated", userId: "42" } },
      } as unknown as Response;

      expect(identityRateLimitKey(fakeRequest("10.0.0.7"), res)).toBe("u:42");
    });

    it("keys anonymous callers by their normalized address", () => {
      const res = { locals: {} } as unknown as Response;

      expect(identityRateLimitKey(fakeRequest("10.0.0.7"), res)).toBe(
        "ip:10.0.0.7",
      );
    });

    it("normalizes IPv6 to a subnet instead of a raw address", () => {
      const key = clientIpKey(fakeRequest("2001:db8::1"));

      expect(key).toMatch(/\/56$/);
      expect(key).not.toBe("2001:db8::1");
    });
  });

  describe("sanitizeInput", () => {
    it("keeps report text intact so a student can quote HTML", () => {
      const req = {
        body: { message: "  the button says <div> and breaks  " },
      } as unknown as Request;
      const next = vi.fn();

      sanitizeInput(req, {} as Response, next);

      expect(req.body.message).toBe("the button says <div> and breaks");
      expect(next).toHaveBeenCalledOnce();
    });
  });
});
