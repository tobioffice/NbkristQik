import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifyInitData } from "../../src/services/telegramAuth.js";
import { TELEGRAM_BOT_TOKEN } from "../../src/config/environmentals.js";

// Sign with the token the module actually loaded: tests/setup.ts exports
// fixture env vars, but a developer .env can still supply the real token
// to the module (dotenv runs at import time), so mirror that value here.
const TOKEN = TELEGRAM_BOT_TOKEN || "test_bot_token";

const signInitData = (
  params: Record<string, string>,
  botToken: string = TOKEN,
): string => {
  const search = new URLSearchParams(params);
  const dataCheckString = [...search.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const hash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");
  search.set("hash", hash);
  return search.toString();
};

const freshAuthDate = () => String(Math.floor(Date.now() / 1000));

describe("verifyInitData", () => {
  it("accepts a correctly signed payload", () => {
    const initData = signInitData({
      auth_date: freshAuthDate(),
      user: JSON.stringify({ id: 12345, first_name: "Test" }),
    });

    const user = verifyInitData(initData);
    expect(user?.id).toBe(12345);
    expect(user?.first_name).toBe("Test");
  });

  it("rejects a signature made with a different token", () => {
    const initData = signInitData(
      { auth_date: freshAuthDate(), user: JSON.stringify({ id: 1 }) },
      "wrong-token",
    );

    expect(verifyInitData(initData)).toBeNull();
  });

  it("rejects a tampered payload even with a valid-looking hash", () => {
    const initData = signInitData({
      auth_date: freshAuthDate(),
      user: JSON.stringify({ id: 12345 }),
    });
    const tampered = initData.replace(
      encodeURIComponent(JSON.stringify({ id: 12345 })),
      encodeURIComponent(JSON.stringify({ id: 99999 })),
    );

    expect(verifyInitData(tampered)).toBeNull();
  });

  it("rejects stale initData older than the 24h replay window", () => {
    const stale = String(Math.floor(Date.now() / 1000) - 25 * 60 * 60);
    const initData = signInitData({
      auth_date: stale,
      user: JSON.stringify({ id: 12345 }),
    });

    expect(verifyInitData(initData)).toBeNull();
  });

  it("rejects missing hash, missing auth_date, and malformed input", () => {
    expect(verifyInitData("user=%7B%22id%22%3A1%7D")).toBeNull();
    expect(
      verifyInitData(signInitData({ user: JSON.stringify({ id: 1 }) })),
    ).toBeNull();
    expect(verifyInitData("")).toBeNull();
  });

  it("rejects a payload without a user id", () => {
    const initData = signInitData({
      auth_date: freshAuthDate(),
      user: JSON.stringify({ first_name: "NoId" }),
    });

    expect(verifyInitData(initData)).toBeNull();
  });
});
