import { describe, it, expect, beforeEach, vi } from "vitest";

// an in-memory stand-in for the session store
const store = new Map<string, string>();
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  })),
}));

const {
  createSession,
  readSession,
  dropSession,
  readCookie,
  LIBRARY_SESSION_COOKIE,
} = await import("../../src/services/library/session.js");

describe("library sessions", () => {
  beforeEach(() => {
    store.clear();
  });

  it("mints a token that reads back to the same student", async () => {
    const token = await createSession("424242");
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const session = await readSession(token);
    expect(session?.userId).toBe("424242");
  });

  it("mints a different token every time", async () => {
    const first = await createSession("1");
    const second = await createSession("1");
    expect(first).not.toBe(second);
  });

  it("refuses a token it never issued", async () => {
    expect(await readSession("made-up")).toBeNull();
    expect(await readSession(undefined)).toBeNull();
  });

  it("drops a session for good", async () => {
    const token = await createSession("7");
    await dropSession(token);
    expect(await readSession(token)).toBeNull();
  });
});

describe("reading a cookie", () => {
  it("finds the one it wants", () => {
    const header = "theme=dark; nbq_lib=abc123; other=1";
    expect(readCookie(header, LIBRARY_SESSION_COOKIE)).toBe("abc123");
  });

  it("returns nothing when the cookie is absent", () => {
    expect(readCookie("theme=dark", LIBRARY_SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, LIBRARY_SESSION_COOKIE)).toBeUndefined();
  });

  it("keeps a token that contains padding", () => {
    expect(readCookie("nbq_lib=a%2Bb%3Dc", LIBRARY_SESSION_COOKIE)).toBe(
      "a+b=c",
    );
  });
});
