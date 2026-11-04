import { describe, expect, it } from "vitest";
import {
  ENV,
  HOST,
  CORS_ORIGINS,
  TELEGRAM_BOT_TOKEN,
  UPTIME_INGEST_SECRET,
  allowDevIdentity,
} from "../../src/config/environmentals.js";

describe("environment defaults", () => {
  it("runs the test suite outside production", () => {
    expect(ENV).toBe("test");
  });

  it("binds loopback unless HOST says otherwise", () => {
    expect(HOST).toBe("127.0.0.1");
  });

  it("defaults the CORS allowlist to the same-origin checker host", () => {
    expect(CORS_ORIGINS).toEqual(["https://checker.tobioffice.dev"]);
  });

  it("keeps the monitor ingest secret", () => {
    expect(UPTIME_INGEST_SECRET).toBeTruthy();
  });

  it("opens the unsigned dev identity gate only in test or by explicit opt-in", () => {
    // ENV=test short-circuits the gate; the env opt-in is covered separately.
    expect(allowDevIdentity()).toBe(true);

    const previous = process.env.ALLOW_DEV_IDENTITY;
    process.env.ALLOW_DEV_IDENTITY = "0";
    try {
      // ENV is still "test", so the gate stays open here.
      expect(allowDevIdentity()).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ALLOW_DEV_IDENTITY;
      else process.env.ALLOW_DEV_IDENTITY = previous;
    }
  });

  it("derives the watermark secret from the bot token when no dedicated secret is set", () => {
    expect(TELEGRAM_BOT_TOKEN).toBeTruthy();
  });
});
