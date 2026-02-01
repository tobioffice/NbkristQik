import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidRollNumber,
  createRateLimit,
  botSecurityHandler
} from '../../src/middleware/security.js';

// Mock Redis client
vi.mock('../src/services/redis/getRedisClient.js', () => ({
  getClient: vi.fn(() => Promise.resolve({
    incr: vi.fn(),
    expire: vi.fn()
  }))
}));

describe('Security Middleware', () => {
  describe('isValidRollNumber', () => {
    it('should validate correct roll number format', () => {
      // Using a roll number that matches the regex: 2 digits + 2 letters + 6 alphanumeric
      expect(isValidRollNumber('21B8AA05E9')).toBe(true);
      expect(isValidRollNumber('22C9BB12F3')).toBe(true);
      expect(isValidRollNumber('21b8aa05e9')).toBe(true); // case insensitive
    });

    it('should reject invalid roll number formats', () => {
      expect(isValidRollNumber('123456789')).toBe(false);
      expect(isValidRollNumber('21B81A05')).toBe(false); // too short
      expect(isValidRollNumber('21B81A05E90')).toBe(false); // too long
      expect(isValidRollNumber('ABC123')).toBe(false); // wrong format
      expect(isValidRollNumber('')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isValidRollNumber('  21B8AA05E9  ')).toBe(true); // trimmed
      expect(isValidRollNumber('21B8AA05E9!')).toBe(false); // special chars
    });
  });

  describe('botSecurityHandler', () => {
    beforeEach(() => {
      // Reset rate limiting for tests
      vi.clearAllMocks();
    });

    it('should allow requests within rate limit', async () => {
      const userId = 12345;
      const allowed = await botSecurityHandler(userId, 'message');
      expect(allowed).toBe(true);
    });

    it('should block excessive requests', async () => {
      const userId = 12345;

      // Make 10 requests (should all be allowed)
      for (let i = 0; i < 10; i++) {
        const allowed = await botSecurityHandler(userId, 'message');
        expect(allowed).toBe(true);
      }

      // 11th request should be blocked
      const blocked = await botSecurityHandler(userId, 'message');
      expect(blocked).toBe(false);
    });
  });

  describe('createRateLimit', () => {
    it('should create rate limit middleware', () => {
      const limiter = createRateLimit(
        15 * 60 * 1000, // 15 minutes
        100, // 100 requests
        'Rate limit exceeded'
      );

      expect(limiter).toBeDefined();
      expect(typeof limiter).toBe('function');
    });
  });
});