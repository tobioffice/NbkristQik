import { describe, it, expect, beforeEach, vi } from "vitest";

// an in-memory stand-in for the session store
const store = new Map<string, string>();
const ttls = new Map<string, number | undefined>();
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(
      async (key: string, value: string, options?: { EX?: number }) => {
        store.set(key, value);
        ttls.set(key, options?.EX);
        return "OK";
      },
    ),
    getDel: vi.fn(async (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
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
  createPcLoginToken,
  consumePcLoginToken,
  LIBRARY_SESSION_COOKIE,
  LIBRARY_SESSION_TTL_SECONDS,
  LIBRARY_PC_TOKEN_TTL_SECONDS,
  librarySessionCookieOptions,
  readCookies,
  readSessionFromCookies,
} = await import("../../src/services/library/session.js");

describe("library sessions", () => {
  beforeEach(() => {
    store.clear();
    ttls.clear();
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

describe("PC login tokens", () => {
  beforeEach(() => {
    store.clear();
    ttls.clear();
  });

  it("mints a token that signs in exactly once", async () => {
    const token = await createPcLoginToken("424242");
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    expect(await consumePcLoginToken(token)).toBe("424242");
    // the link is spent: a forwarded URL cannot sign in a second browser
    expect(await consumePcLoginToken(token)).toBeNull();
  });

  it("keeps the token for five minutes", async () => {
    const token = await createPcLoginToken("7");

    expect(LIBRARY_PC_TOKEN_TTL_SECONDS).toBe(5 * 60);
    expect(ttls.get(`lib:pc:${token}`)).toBe(LIBRARY_PC_TOKEN_TTL_SECONDS);
    expect(store.get(`lib:pc:${token}`)).toBe("7");
  });

  it("returns null for a token it never issued", async () => {
    expect(await consumePcLoginToken("made-up")).toBeNull();
    expect(await consumePcLoginToken("")).toBeNull();
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

describe("the session cookie attributes", () => {
  it("can cross the Telegram Web iframe in production", () => {
    const options = librarySessionCookieOptions(true);

    // Telegram Web embeds the app in an iframe on web.telegram.org: a Strict
    // cookie is stored and never sent back there, which is the PC 401.
    expect(options.sameSite).toBe("none");
    expect(options.secure).toBe(true);
    // CHIPS: browsers that block third-party cookies still keep this one
    expect(options.partitioned).toBe(true);
    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe("/");
    expect(options.maxAge).toBe(LIBRARY_SESSION_TTL_SECONDS * 1000);
  });

  it("keeps a short PC session short", () => {
    expect(librarySessionCookieOptions(true, 3600).maxAge).toBe(3_600_000);
  });

  it("stays Lax on plain http, where None would be dropped", () => {
    const options = librarySessionCookieOptions(false);

    expect(options.sameSite).toBe("lax");
    expect(options.secure).toBe(false);
    expect(options.partitioned).toBe(false);
  });
});

describe("a request carrying two copies of the cookie", () => {
  it("finds the live session behind a stale copy", async () => {
    const live = await createSession("4242");
    const header = `nbq_lib=expired; nbq_lib=${live}`;

    expect(readCookies(header, LIBRARY_SESSION_COOKIE)).toEqual([
      "expired",
      live,
    ]);

    const found = await readSessionFromCookies(header);
    expect(found?.token).toBe(live);
    expect(found?.session.userId).toBe("4242");
  });

  it("opens nothing when every copy is dead", async () => {
    expect(await readSessionFromCookies("nbq_lib=one; nbq_lib=two")).toBeNull();
    expect(await readSessionFromCookies(undefined)).toBeNull();
  });
});
