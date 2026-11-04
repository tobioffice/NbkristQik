import { describe, it, expect } from "vitest";
import {
  tokenHash,
  safeEqual,
  parseCookies,
  isLoginLocked,
  recordLoginFailure,
  clearLoginAttempts,
  SESSION_COOKIE,
} from "../../src/api/admin/auth.js";

describe("admin auth primitives", () => {
  it("hashes tokens with HMAC keyed by the password", () => {
    const hash = tokenHash("some-token", "password-a");

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // same password + token is deterministic, different password differs
    expect(tokenHash("some-token", "password-a")).toBe(hash);
    expect(tokenHash("some-token", "password-b")).not.toBe(hash);
    expect(tokenHash("other-token", "password-a")).not.toBe(hash);
  });

  it("compares secrets safely and rejects different lengths", () => {
    expect(safeEqual("hunter2", "hunter2")).toBe(true);
    expect(safeEqual("hunter2", "hunter3")).toBe(false);
    expect(safeEqual("short", "longer-password")).toBe(false);
  });

  it("parses and URL-decodes cookie headers", () => {
    const cookies = parseCookies(
      `${SESSION_COOKIE}=abc123; theme=dark; note=a%20b`,
    );

    expect(cookies[SESSION_COOKIE]).toBe("abc123");
    expect(cookies.theme).toBe("dark");
    expect(cookies.note).toBe("a b");
    expect(parseCookies(undefined)).toEqual({});
  });

  it("locks an IP after 5 recorded failures, not after a check alone", () => {
    const ip = `test-ip-${Math.random()}`;

    // checking the lock is read-only: it must not count as an attempt
    for (let i = 0; i < 10; i++) {
      expect(isLoginLocked(ip)).toBe(false);
    }

    for (let i = 0; i < 5; i++) {
      expect(isLoginLocked(ip)).toBe(false);
      recordLoginFailure(ip);
    }
    expect(isLoginLocked(ip)).toBe(true);

    // an attacker's block does not affect other IPs
    expect(isLoginLocked(`${ip}-other`)).toBe(false);
  });

  it("clears the counter after a successful login", () => {
    const ip = `test-ip-${Math.random()}`;
    recordLoginFailure(ip);
    recordLoginFailure(ip);
    expect(isLoginLocked(ip)).toBe(false);

    clearLoginAttempts(ip);
    expect(isLoginLocked(ip)).toBe(false);

    // and the next failure starts a new, single-count window
    recordLoginFailure(ip);
    expect(isLoginLocked(ip)).toBe(false);
  });
});
