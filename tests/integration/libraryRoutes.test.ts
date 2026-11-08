import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import os from "os";
import path from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { createClient } from "@libsql/client";

// in-memory Turso shared by the whole file process
const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

// in-memory session store
const sessions = new Map<string, string>();
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    get: vi.fn(async (key: string) => sessions.get(key) ?? null),
    set: vi.fn(
      async (
        key: string,
        value: string,
        options?: { NX?: boolean; EX?: number },
      ) => {
        // SET NX is how read dedupe claims a page; the session write has EX
        if (options?.NX && sessions.has(key)) return null;
        sessions.set(key, value);
        return "OK";
      },
    ),
    del: vi.fn(async (key: string) => {
      sessions.delete(key);
      return 1;
    }),
    getDel: vi.fn(async (key: string) => {
      const value = sessions.get(key) ?? null;
      sessions.delete(key);
      return value;
    }),
    expire: vi.fn(async () => 1),
    incr: vi.fn(async (key: string) => {
      const next = (sessions.get(key) ?? "0").replace(/\D/g, "");
      const count = Number(next || 0) + 1;
      sessions.set(key, String(count));
      return count;
    }),
    incrBy: vi.fn(async (key: string, weight: number) => {
      const next = (sessions.get(key) ?? "0").replace(/\D/g, "");
      const count = Number(next || 0) + weight;
      sessions.set(key, String(count));
      return count;
    }),
  })),
}));

vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
  trackMessage: vi.fn(),
}));

/**
 * The PDF route is exercised against a fixed file instead of running pdf-lib:
 * stamping is covered by tests/unit/libraryPdf.test.ts, and a real multi-page
 * PDF per request would only make this suite slower.
 */
const downloadFixture = path.join(
  os.tmpdir(),
  "nbq-library-pdf-route",
  "stamped.pdf",
);
vi.mock("../../src/services/library/pdf.js", () => {
  class PdfBusyError extends Error {}
  class PdfTooLargeError extends Error {}
  return {
    ensureWatermarkedPdf: vi.fn(async () => downloadFixture),
    PdfBusyError,
    PdfTooLargeError,
  };
});

/**
 * Build a signed initData blob the way Telegram does, so the test exercises
 * the real verification path instead of a mock of it.
 */
const makeInitData = (userId: number, token = "test_bot_token"): string => {
  const user = JSON.stringify({ id: userId, first_name: "Test" });
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "TEST",
    user,
  });
  const dataCheckString = [...params.entries()]
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(token)
    .digest();
  const hash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");
  params.set("hash", hash);
  return params.toString();
};

beforeAll(async () => {
  mkdirSync(path.dirname(downloadFixture), { recursive: true });
  writeFileSync(downloadFixture, "%PDF-1.4\n% stamped fixture\n%%EOF\n");

  await client.batch(
    [
      `CREATE TABLE registrations (
        userId TEXT PRIMARY KEY,
        roll_no TEXT NOT NULL,
        display_name TEXT,
        registered_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE studentsnew (
        roll_no TEXT PRIMARY KEY,
        name TEXT,
        section TEXT,
        branch TEXT,
        year TEXT
      )`,
      `INSERT INTO studentsnew VALUES ('23CS1042', 'TEST STUDENT', 'A', '5', '31')`,
      `INSERT INTO studentsnew VALUES ('22CS1042', 'OLD BATCH', 'A', '5', '21')`,
      `INSERT INTO studentsnew VALUES ('23CS1001', 'FIRST YEAR', 'A', '5', '11')`,
      `CREATE TABLE library_documents (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        dept TEXT NOT NULL,
        regulation TEXT NOT NULL,
        year_sem TEXT NOT NULL,
        unit TEXT,
        kind TEXT NOT NULL,
        source_path TEXT NOT NULL,
        page_count INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'coming_soon',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (code, unit, kind)
      )`,
      `CREATE TABLE library_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        page INTEGER NOT NULL,
        token TEXT,
        at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `INSERT INTO library_documents
        (id, code, title, dept, regulation, year_sem, unit, kind, source_path, page_count, status)
       VALUES ('23CS31T2-u2', '23CS31T2', 'Computer Networks & Internet Protocols',
               'CSE', 'R23', '31', 'II', 'material', 'data/docs/23CS31T2-u2.pdf', 26, 'live'),
        ('23CS31T2-u3', '23CS31T2', 'Computer Networks & Internet Protocols',
               'CSE', 'R23', '31', 'III', 'material', 'data/docs/23CS31T2-u3.pdf', 24, 'live')`,
    ],
    "write",
  );
});

const { app } = await import("../../src/api/server.js");
const { upsertRegistration } =
  await import("../../src/db/registration.model.js");
const { invalidateStudentContext } =
  await import("../../src/services/library/entitlement.js");
const { createPcLoginToken } =
  await import("../../src/services/library/session.js");

/**
 * Opens a library session from a given address.
 *
 * The session-exchange limiter allows 20 calls an hour per address, and this
 * file already uses most of that budget. A test that needs its own session
 * comes from its own address rather than draining the shared one; the app
 * trusts one proxy hop, so the forwarded header is the client address.
 */
const openSessionFrom = async (userId: number, ip: string): Promise<string> => {
  const open = await request(app)
    .post("/api/library/session")
    .set("X-Forwarded-For", ip)
    .send({ initData: makeInitData(userId) });
  return open.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
};

const REGISTERED = 111222333;
const UNREGISTERED = 999888777;
/** A first-year student: their subjects are not the third-year ones. */
const FIRST_YEAR = 555444333;

/** A stand-in vector page on disk, so the reader has something to serve. */
const dataDir = path.join(os.tmpdir(), "nbq-library-test");
process.env.LIBRARY_DATA_DIR = dataDir;
// a previous run's fixtures must not make this run's shelf look full
rmSync(dataDir, { recursive: true, force: true });

const makePage = (docId: string, page: number): void => {
  const dir = path.join(dataDir, "pages", docId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `p${String(page).padStart(3, "0")}.svg`),
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="594.95996pt" height="841.91998pt" viewBox="0 0 594.95996 841.91998">' +
      '<rect width="10" height="10"/>' +
      "</svg>",
  );
};

describe("opening the library", () => {
  it("swaps a signed initData for a session cookie", async () => {
    await upsertRegistration(String(REGISTERED), "23CS1042", "Test Student");

    const res = await request(app)
      .post("/api/library/session")
      .send({ initData: makeInitData(REGISTERED) });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.registered).toBe(true);
    expect(res.body.student.rollNo).toBe("23CS1042");
    expect(res.body.student.dept).toBe("CSE");
    expect(res.body.student.regulation).toBe("R23");
    expect(res.body.student.yearSem).toBe("31");

    const cookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toContain("nbq_lib=");
    expect(cookie).toContain("HttpOnly");
    // test env is http: the relaxed production pair (None + Partitioned) is
    // covered in tests/unit/librarySession.test.ts
    expect(cookie).toContain("SameSite=Lax");
  });

  it("accepts the live cookie even when a stale copy is listed first", async () => {
    await upsertRegistration(String(REGISTERED), "23CS1042", "Test Student");
    const cookie = await openSessionFrom(REGISTERED, "198.51.100.99");

    const res = await request(app)
      .get("/api/library/subjects")
      .set("Cookie", `nbq_lib=made-up-token; ${cookie}`);

    // both a Strict and a Partitioned jar can carry nbq_lib: the first one
    // listed must not shadow the live one
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("reuses a valid session instead of minting another", async () => {
    sessions.clear();
    const ip = "198.51.100.10";

    const first = await request(app)
      .post("/api/library/session")
      .set("X-Forwarded-For", ip)
      .send({ initData: makeInitData(REGISTERED) });
    const setCookie = first.headers["set-cookie"]?.[0] ?? "";
    const cookie = setCookie.split(";")[0] ?? "";
    expect(cookie).toContain("nbq_lib=");

    // a tab visit re-POSTs with the cookie: same user, same token, no new key
    const second = await request(app)
      .post("/api/library/session")
      .set("X-Forwarded-For", ip)
      .set("Cookie", cookie)
      .send({ initData: makeInitData(REGISTERED) });

    expect(second.status).toBe(200);
    expect(second.body.student.rollNo).toBe("23CS1042");
    expect(second.headers["set-cookie"]?.[0]).toBe(setCookie);

    const sessionKeys = [...sessions.keys()].filter((key) =>
      key.startsWith("lib:sess:"),
    );
    expect(sessionKeys).toHaveLength(1);

    // logout drops it for good
    await request(app).delete("/api/library/session").set("Cookie", cookie);
    expect(
      [...sessions.keys()].filter((key) => key.startsWith("lib:sess:")),
    ).toHaveLength(0);
  });

  it("mints a fresh session when the cookie is stale", async () => {
    const res = await request(app)
      .post("/api/library/session")
      .set("X-Forwarded-For", "198.51.100.11")
      .set("Cookie", "nbq_lib=made-up-token")
      .send({ initData: makeInitData(REGISTERED) });

    expect(res.status).toBe(200);
    const cookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toContain("nbq_lib=");
    expect(cookie).not.toContain("made-up-token");
  });

  it("refuses a blob that was not signed by Telegram", async () => {
    const res = await request(app)
      .post("/api/library/session")
      .send({ initData: makeInitData(REGISTERED, "some_other_bot_token") });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("refuses a blob with no signature at all", async () => {
    const res = await request(app)
      .post("/api/library/session")
      .send({ initData: "auth_date=1&user=%7B%22id%22%3A1%7D" });

    expect(res.status).toBe(401);
  });
});

describe("opening the library on a PC", () => {
  it("swaps a one-shot bot link for a session cookie", async () => {
    await upsertRegistration(String(REGISTERED), "23CS1042", "Test Student");
    const pcToken = await createPcLoginToken(String(REGISTERED));

    const res = await request(app)
      .post("/api/library/session")
      .set("X-Forwarded-For", "198.51.100.30")
      .send({ pcToken });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.registered).toBe(true);
    expect(res.body.student.rollNo).toBe("23CS1042");

    const cookie = res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    expect(cookie).toContain("nbq_lib=");

    // a PC browser has no Telegram identity: the cookie alone must be enough
    // for the app to keep showing the Library tab after a reload
    const config = await request(app).get("/api/config").set("Cookie", cookie);
    expect(config.status).toBe(200);
    expect(config.body.libraryOpen).toBe(true);

    // the link is spent: a forwarded URL cannot sign in a second browser
    const again = await request(app)
      .post("/api/library/session")
      .set("X-Forwarded-For", "198.51.100.31")
      .send({ pcToken });

    expect(again.status).toBe(401);
    expect(again.body.error).toContain("expired");
  });

  it("does not fall back to initData when the pcToken is bad", async () => {
    const res = await request(app)
      .post("/api/library/session")
      .set("X-Forwarded-For", "198.51.100.32")
      .send({ pcToken: "never-issued", initData: makeInitData(REGISTERED) });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain("expired");
  });
});

describe("reading the library", () => {
  it("needs a session", async () => {
    const res = await request(app).get("/api/library/subjects");
    expect(res.status).toBe(401);
  });

  it("lists the material it holds for the running semester", async () => {
    await upsertRegistration(String(REGISTERED), "23CS1042", "Test Student");
    const open = await request(app)
      .post("/api/library/session")
      .send({ initData: makeInitData(REGISTERED) });
    const cookie = open.headers["set-cookie"]?.[0]?.split(";")[0];

    const res = await request(app)
      .get("/api/library/subjects")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    // the shelf is our corpus, not the syllabus: only cut subjects appear
    const codes = res.body.subjects.map((s: { code: string }) => s.code);
    expect(codes).toEqual(["23CS31T2"]);
    const cn = res.body.subjects[0];
    expect(cn.live).toBe(true);
    expect(cn.units).toEqual([
      { id: "23CS31T2-u2", unit: "II", pages: 26 },
      { id: "23CS31T2-u3", unit: "III", pages: 24 },
    ]);
  });

  it("keeps another semester's material off the shelf", async () => {
    await client.execute(
      `INSERT INTO library_documents
        (id, code, title, dept, regulation, year_sem, unit, kind, source_path, page_count, status)
       VALUES ('23CS21T1-u1', '23CS21T1', 'Advanced Data Structures & Algorithm Analysis',
               'CSE', 'R23', '21', 'I', 'material', 'data/docs/23CS21T1-u1.pdf', 7, 'live')`,
    );

    const openAs = async (userId: number, roll: string): Promise<string> => {
      await upsertRegistration(String(userId), roll, "Test Student");
      const res = await request(app)
        .post("/api/library/session")
        .send({ initData: makeInitData(userId) });
      return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    };

    // a 24-batch roll is R23 like the documents, and sits in 2-1 here
    await client.execute(
      `INSERT OR REPLACE INTO studentsnew VALUES ('24CS1042', 'SECOND YEAR', 'A', '5', '21')`,
    );
    // a distinct third-year roll: one roll belongs to one Telegram account,
    // so 333444555 cannot claim REGISTERED's 23CS1042
    await client.execute(
      `INSERT OR REPLACE INTO studentsnew VALUES ('23CS1043', 'THIRD YEAR B', 'A', '5', '31')`,
    );
    const secondYear = await openAs(222333444, "24CS1042");
    const theirs = await request(app)
      .get("/api/library/subjects")
      .set("Cookie", secondYear);
    expect(theirs.body.subjects.map((s: { code: string }) => s.code)).toEqual([
      "23CS21T1",
    ]);

    const thirdYear = await openAs(333444555, "23CS1043");
    const ours = await request(app)
      .get("/api/library/subjects")
      .set("Cookie", thirdYear);
    expect(ours.body.subjects.map((s: { code: string }) => s.code)).toEqual([
      "23CS31T2",
    ]);
  });

  it("tells a student who has not registered to register", async () => {
    const open = await request(app)
      .post("/api/library/session")
      .send({ initData: makeInitData(UNREGISTERED) });
    const cookie = open.headers["set-cookie"]?.[0]?.split(";")[0];

    expect(open.status).toBe(200);
    expect(open.body.registered).toBe(false);

    const res = await request(app)
      .get("/api/library/subjects")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("drops the session when the student leaves", async () => {
    const open = await request(app)
      .post("/api/library/session")
      .send({ initData: makeInitData(REGISTERED) });
    const cookie = open.headers["set-cookie"]?.[0]?.split(";")[0];

    const res = await request(app)
      .delete("/api/library/session")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);

    const after = await request(app)
      .get("/api/library/subjects")
      .set("Cookie", cookie);
    expect(after.status).toBe(401);
  });
});

describe("reading a page", () => {
  const openSession = async (userId: number): Promise<string> => {
    const open = await request(app)
      .post("/api/library/session")
      .send({ initData: makeInitData(userId) });
    return open.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
  };

  it("serves one watermarked page", async () => {
    makePage("23CS31T2-u2", 1);
    const cookie = await openSession(REGISTERED);

    const res = await request(app)
      .get("/api/library/page/23CS31T2-u2/1")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    // a private cache may keep the stamped page: the mark is per reader
    expect(res.headers["cache-control"]).toContain("private");
    expect(res.headers["cache-control"]).toContain("max-age=300");
    expect(res.headers["vary"]).toContain("Cookie");
    // the stamped page is still an svg, with the reader's token drawn in
    const page = res.body.toString("utf8");
    expect(page).toContain("<svg");
    expect(page.trimEnd().endsWith("</svg>")).toBe(true);
    expect(page).toMatch(/NBK-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}/);
    expect(page).toContain("<text");
  });

  it("records the read with the reader's token", async () => {
    makePage("23CS31T2-u2", 1);
    const cookie = await openSession(REGISTERED);

    await request(app)
      .get("/api/library/page/23CS31T2-u2/1")
      .set("Cookie", cookie);
    await new Promise((r) => setTimeout(r, 200));

    const rows = await client.execute({
      sql: `SELECT user_id, token FROM library_reads WHERE doc_id = ?`,
      args: ["23CS31T2-u2"],
    });
    expect(rows.rows.length).toBeGreaterThan(0);
    const row = rows.rows[0];
    if (!row) throw new Error("expected a recorded library read");
    expect(String(row.user_id)).toBe(String(REGISTERED));
    expect(String(row.token)).toMatch(
      /^NBK-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/,
    );
  });

  it("refuses a page that is not in the document", async () => {
    const cookie = await openSession(REGISTERED);
    const res = await request(app)
      .get("/api/library/page/23CS31T2-u2/999")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("refuses a live document whose pages are not on the shelf yet", async () => {
    const cookie = await openSession(REGISTERED);
    const res = await request(app)
      .get("/api/library/page/23CS31T2-u3/1")
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("refuses a document that does not exist", async () => {
    const cookie = await openSession(REGISTERED);
    const res = await request(app)
      .get("/api/library/page/nope/1")
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("refuses a subject that is not the reader's", async () => {
    makePage("23CS31T2-u2", 1);
    await upsertRegistration(String(FIRST_YEAR), "23CS1001", "First Year");
    const cookie = await openSession(FIRST_YEAR);

    const res = await request(app)
      .get("/api/library/page/23CS31T2-u2/1")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("still refuses another semester's document for a cached reader", async () => {
    // a live document on a semester this reader is not in
    await client.execute(
      `INSERT OR REPLACE INTO library_documents
        (id, code, title, dept, regulation, year_sem, unit, kind, source_path, page_count, status)
       VALUES ('21CS99T9-u1', '21CS99T9', 'Other Semester Subject',
               'CSE', 'R23', '21', 'I', 'material', 'data/docs/21CS99T9-u1.pdf', 5, 'live')`,
    );
    makePage("23CS31T2-u2", 1);

    const cookie = await openSessionFrom(REGISTERED, "198.51.100.12");

    // this first request resolves and caches the reader and the document row
    const own = await request(app)
      .get("/api/library/page/23CS31T2-u2/1")
      .set("Cookie", cookie);
    expect(own.status).toBe(200);

    const doc = await request(app)
      .get("/api/library/document/21CS99T9-u1")
      .set("Cookie", cookie);
    expect(doc.status).toBe(403);

    const page = await request(app)
      .get("/api/library/page/21CS99T9-u1/1")
      .set("Cookie", cookie);
    expect(page.status).toBe(403);
  });

  it("records one audit row for two reads of the same page in an hour", async () => {
    makePage("23CS31T2-u2", 11);
    const cookie = await openSessionFrom(REGISTERED, "198.51.100.13");
    await client.execute({
      sql: `DELETE FROM library_reads WHERE doc_id = ? AND page = ?`,
      args: ["23CS31T2-u2", 11],
    });

    const burstKey = `lib:reads:${REGISTERED}`;
    const burstBefore = Number(sessions.get(burstKey) ?? "0");

    const first = await request(app)
      .get("/api/library/page/23CS31T2-u2/11")
      .set("Cookie", cookie);
    const second = await request(app)
      .get("/api/library/page/23CS31T2-u2/11")
      .set("Cookie", cookie);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 250));

    const rows = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM library_reads WHERE doc_id = ? AND page = ?`,
      args: ["23CS31T2-u2", 11],
    });
    expect(Number(rows.rows[0]?.n ?? 0)).toBe(1);

    // the burst counter is telemetry per delivery, not per audit row
    expect(Number(sessions.get(burstKey) ?? "0")).toBe(burstBefore + 2);
  });

  it("sees a changed roll on the next page once the reader cache is invalidated", async () => {
    await client.execute(
      `INSERT OR REPLACE INTO studentsnew VALUES ('23CS1044', 'MOVED STUDENT', 'A', '5', '11')`,
    );
    makePage("23CS31T2-u2", 1);

    const cookie = await openSessionFrom(REGISTERED, "198.51.100.14");
    const before = await request(app)
      .get("/api/library/page/23CS31T2-u2/1")
      .set("Cookie", cookie);
    expect(before.status).toBe(200);

    // what profile.ts will do after a successful registration write
    await upsertRegistration(String(REGISTERED), "23CS1044", "Test Student");
    invalidateStudentContext(String(REGISTERED));

    const after = await request(app)
      .get("/api/library/page/23CS31T2-u2/1")
      .set("Cookie", cookie);
    expect(after.status).toBe(403);

    // restore the fixture for anything that follows in this file
    await upsertRegistration(String(REGISTERED), "23CS1042", "Test Student");
    invalidateStudentContext(String(REGISTERED));
  });

  it("needs a session", async () => {
    const res = await request(app).get("/api/library/page/23CS31T2-u2/1");
    expect(res.status).toBe(401);
  });
});

describe("downloading a document", () => {
  const openSession = async (userId: number, ip: string): Promise<string> => {
    const open = await request(app)
      .post("/api/library/session")
      .set("X-Forwarded-For", ip)
      .send({ initData: makeInitData(userId) });
    return open.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
  };

  it("needs a session", async () => {
    const res = await request(app).get("/api/library/document/23CS31T2-u2/pdf");
    expect(res.status).toBe(401);
  });

  it("refuses another semester's document", async () => {
    await upsertRegistration(String(FIRST_YEAR), "23CS1001", "First Year");
    const cookie = await openSession(FIRST_YEAR, "198.51.100.40");

    const res = await request(app)
      .get("/api/library/document/23CS31T2-u2/pdf")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("sends the stamped PDF as an attachment, privately cached", async () => {
    const cookie = await openSession(REGISTERED, "198.51.100.41");

    const res = await request(app)
      .get("/api/library/document/23CS31T2-u2/pdf")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain(
      "NbkristQik-23CS31T2-uII.pdf",
    );
    expect(res.headers["cache-control"]).toContain("private");
    expect(res.headers["cache-control"]).toContain("max-age=3600");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(Buffer.from(res.body).subarray(0, 5).toString("latin1")).toBe(
      "%PDF-",
    );
  });

  it("records one download row per hour, as page 0", async () => {
    const cookie = await openSession(REGISTERED, "198.51.100.42");

    // let the previous test's fire-and-forget claim land, then reset both the
    // dedupe key and the audit table
    await new Promise((resolve) => setTimeout(resolve, 250));
    sessions.delete(`lib:read:${REGISTERED}:23CS31T2-u2:pdf`);
    await client.execute({
      sql: `DELETE FROM library_reads WHERE doc_id = ? AND page = 0`,
      args: ["23CS31T2-u2"],
    });

    await request(app)
      .get("/api/library/document/23CS31T2-u2/pdf")
      .set("Cookie", cookie);
    await request(app)
      .get("/api/library/document/23CS31T2-u2/pdf")
      .set("Cookie", cookie);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const rows = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM library_reads WHERE doc_id = ? AND page = 0`,
      args: ["23CS31T2-u2"],
    });
    expect(Number(rows.rows[0]?.n ?? 0)).toBe(1);
  });
});

/**
 * The library ships before the material does: until LIBRARY_ACCESS is "all",
 * only the admin's Telegram account may open it, even with the URL in hand.
 */
describe("while the library is closed", () => {
  const withClosedLibrary = async <T>(run: () => Promise<T>): Promise<T> => {
    process.env.LIBRARY_ACCESS = "admin";
    try {
      return await run();
    } finally {
      process.env.LIBRARY_ACCESS = "all";
    }
  };

  it("refuses a student's session and allows the admin's", async () => {
    await withClosedLibrary(async () => {
      const student = await request(app)
        .post("/api/library/session")
        .send({ initData: makeInitData(REGISTERED) });
      expect(student.status).toBe(403);
      expect(student.body.error).toContain("not open");

      const admin = await request(app)
        .post("/api/library/session")
        .send({ initData: makeInitData(123456789) });
      expect(admin.status).toBe(200);
    });
  });

  it("refuses a session that was made before the close", async () => {
    const open = await request(app)
      .post("/api/library/session")
      .send({ initData: makeInitData(REGISTERED) });
    const cookie = open.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    await withClosedLibrary(async () => {
      const me = await request(app)
        .get("/api/library/me")
        .set("Cookie", cookie);
      expect(me.status).toBe(403);

      const subjects = await request(app)
        .get("/api/library/subjects")
        .set("Cookie", cookie);
      expect(subjects.status).toBe(403);
    });
  });
  it("shows the admin the whole shelf, whatever semester they are in", async () => {
    // the admin is a first-year in the college table, and the live document
    // is a third-year subject: the preview must still open it. Use a distinct
    // first-year roll: 23CS1001 already belongs to FIRST_YEAR.
    await client.execute(
      `INSERT OR REPLACE INTO studentsnew VALUES ('23CS1002', 'ADMIN FIRST YEAR', 'A', '5', '11')`,
    );
    await upsertRegistration("123456789", "23CS1002", "Admin");

    const open = await request(app)
      .post("/api/library/session")
      .send({ initData: makeInitData(123456789) });
    const cookie = open.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    await withClosedLibrary(async () => {
      const subjects = await request(app)
        .get("/api/library/subjects")
        .set("Cookie", cookie);
      expect(subjects.status).toBe(200);
      const codes = (subjects.body.subjects as { code: string }[]).map(
        (s) => s.code,
      );
      expect(codes).toContain("23CS31T2");
      expect(subjects.body.preview).toBe(true);

      // and the same admin can ask for exactly what the roll would see
      const roll = await request(app)
        .get("/api/library/subjects?view=roll")
        .set("Cookie", cookie);
      expect(roll.status).toBe(200);
      expect(roll.body.admin).toBe(true);
      expect(roll.body.preview).toBe(false);
      expect(roll.body.subjects).toEqual([]);

      makePage("23CS31T2-u2", 1);
      const page = await request(app)
        .get("/api/library/page/23CS31T2-u2/1")
        .set("Cookie", cookie);
      expect(page.status).toBe(200);
      expect(page.headers["content-type"]).toContain("image/svg+xml");
    });
  });
});
