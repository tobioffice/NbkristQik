import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";

/**
 * The dev identity gate is env-driven, so each case reloads the module with a
 * fake environmentals module. This is the only way to prove that ENV alone
 * does not open the gate.
 */
const loadResolver = async (opts: {
  env: string;
  allowDevIdentity: boolean;
}) => {
  vi.resetModules();
  vi.doMock("../../src/config/environmentals.js", () => ({
    ENV: opts.env,
    allowDevIdentity: () => opts.allowDevIdentity,
    TELEGRAM_BOT_TOKEN: "test_bot_token",
  }));
  return import("../../src/api/resolveUser.js");
};

const fakeRequest = (parts: {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}): Request =>
  ({
    query: parts.query ?? {},
    body: parts.body ?? {},
    get: (name: string) => parts.headers?.[name.toLowerCase()],
  }) as unknown as Request;

describe("resolveUserId identity sources", () => {
  it("reads X-Telegram-Init-Data before the legacy query/body fields", async () => {
    const { resolveUserId } = await loadResolver({
      env: "test",
      allowDevIdentity: true,
    });

    // header wins: it is read at all, and it fails as an invalid signature
    // instead of falling back to the dev userId shortcut
    const fromHeader = resolveUserId(
      fakeRequest({
        headers: { "x-telegram-init-data": "not-a-signature" },
        query: { userId: "12345" },
      }),
    );
    expect(fromHeader).toEqual({
      userId: "",
      error: "Invalid Telegram signature",
    });
  });

  it("rejects oversized header initData with the same error", async () => {
    const { resolveUserId } = await loadResolver({
      env: "test",
      allowDevIdentity: true,
    });

    const oversized = "x".repeat(4097);
    expect(
      resolveUserId(
        fakeRequest({ headers: { "x-telegram-init-data": oversized } }),
      ),
    ).toEqual({ userId: "", error: "Invalid Telegram signature" });
  });

  it("reports an invalid query initData rather than ignoring it", async () => {
    const { resolveUserId } = await loadResolver({
      env: "test",
      allowDevIdentity: true,
    });

    expect(
      resolveUserId(fakeRequest({ query: { initData: "garbage" } })),
    ).toEqual({ userId: "", error: "Invalid Telegram signature" });
  });

  it("returns null when no identity is presented", async () => {
    const { resolveUserId } = await loadResolver({
      env: "test",
      allowDevIdentity: true,
    });

    expect(resolveUserId(fakeRequest({}))).toBeNull();
  });
});

describe("the dev identity gate", () => {
  it("accepts a query userId only with an explicit opt-in", async () => {
    const allowed = await loadResolver({
      env: "development",
      allowDevIdentity: true,
    });
    expect(
      allowed.resolveUserId(fakeRequest({ query: { userId: "12345" } })),
    ).toEqual({ userId: "12345" });

    const denied = await loadResolver({
      env: "development",
      allowDevIdentity: false,
    });
    expect(
      denied.resolveUserId(fakeRequest({ query: { userId: "12345" } })),
    ).toBeNull();
  });

  it("never trusts a bare userId merely because ENV is development", async () => {
    const { resolveUserId, resolveOptionalIdentity } = await loadResolver({
      env: "development",
      allowDevIdentity: false,
    });

    expect(
      resolveUserId(fakeRequest({ body: { userId: "99999" } })),
    ).toBeNull();
    expect(
      resolveOptionalIdentity(fakeRequest({ query: { userId: "99999" } })),
    ).toEqual({ status: "anonymous" });
  });

  it("rejects a malformed dev userId instead of passing it through", async () => {
    const { resolveUserId } = await loadResolver({
      env: "development",
      allowDevIdentity: true,
    });

    expect(
      resolveUserId(fakeRequest({ query: { userId: "12;drop" } })),
    ).toBeNull();
  });

  it("keeps the optional helper's invalid case distinct from anonymous", async () => {
    const { resolveOptionalIdentity } = await loadResolver({
      env: "test",
      allowDevIdentity: true,
    });

    expect(
      resolveOptionalIdentity(
        fakeRequest({ headers: { "x-telegram-init-data": "bad" } }),
      ),
    ).toEqual({ status: "invalid", error: "Invalid Telegram signature" });
  });
});
