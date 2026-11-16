import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createClient } from "@libsql/client";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.ADMIN_ID = "1000000001";
process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

const claimedKeys = new Set<string>();
const redisMock = {
  get: vi.fn(async () => null),
  // true SET-NX semantics: first claim wins, later claims get null
  set: vi.fn(async (key: string) => {
    if (claimedKeys.has(key)) return null;
    claimedKeys.add(key);
    return "OK";
  }),
};
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => redisMock),
}));

// capture bot sends instead of hitting Telegram
const sent: Array<{ to: string; text: string }> = [];
vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    api: {
      sendMessage: vi.fn(
        async ({
          chat_id,
          text,
        }: {
          chat_id: string | number;
          text: string;
        }) => {
          sent.push({ to: String(chat_id), text });
          return { message_id: sent.length };
        },
      ),
    },
  },
}));

vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
  trackMessage: vi.fn(),
}));

beforeAll(async () => {
  await client.batch(
    [
      `CREATE TABLE reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        admin_reply TEXT, replied_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE report_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE report_reads (
        report_id INTEGER NOT NULL,
        reader TEXT NOT NULL,
        last_seen_id INTEGER NOT NULL DEFAULT 0,
        seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (report_id, reader)
      )`,
      `CREATE TABLE report_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        file_name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE botusers (user_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT,
         first_seen TEXT, last_seen TEXT, private_actions INTEGER DEFAULT 0,
         channel_actions INTEGER DEFAULT 0, group_actions INTEGER DEFAULT 0,
         total_actions INTEGER DEFAULT 0)`,
      `INSERT INTO botusers (user_id, username, first_name) VALUES (1000000002, 'test_user', 'TEST USER')`,
      `CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
         chat_type TEXT NOT NULL, action TEXT NOT NULL, detail TEXT,
         created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    ],
    "write",
  );
});

const { app } = await import("../../src/api/server.js");

const USER = "1000000002";

// Screenshots live on disk, never in the repo: point the service at a
// throwaway directory for this file and clean it up afterwards.
const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "qik-report-files-"));
process.env.REPORT_FILES_DIR = uploadsDir;

afterAll(async () => {
  await rm(uploadsDir, { recursive: true, force: true });
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("report screenshot"),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("report screenshot"),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP"),
  Buffer.from("report screenshot"),
]);

const SHOTS_USER = "1000000003";
const DISCARD_USER = "1000000004";

describe("report API", () => {
  it("rejects an unauthenticated submission", async () => {
    const res = await request(app)
      .post("/api/report")
      .send({ message: "Something is broken on the marks page badly" });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("rejects messages that are too short or too long", async () => {
    const short = await request(app)
      .post("/api/report")
      .send({ userId: USER, message: "short" });
    expect(short.status).toBe(400);

    const long = await request(app)
      .post("/api/report")
      .send({ userId: USER, message: "x".repeat(1001) });
    expect(long.status).toBe(400);
  });

  it("files a report, announces it, and returns an issue id", async () => {
    const res = await request(app)
      .post("/api/report")
      .send({ userId: USER, message: "Attendance shows zero for my section" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.issueId).toMatch(/^QIK-\d{4}$/);

    // admin received the notice with the id, reporter was confirmed
    const adminNotice = sent.find((s) => s.to === process.env.ADMIN_ID);
    expect(adminNotice?.text).toContain(res.body.issueId);
    const reporterConfirm = sent.find((s) => s.to === USER);
    expect(reporterConfirm?.text).toContain(res.body.issueId);
  });

  it("throttles the second report within a minute (429)", async () => {
    const res = await request(app)
      .post("/api/report")
      .send({ userId: USER, message: "Another issue with the same account" });

    expect(res.status).toBe(429);
  });

  it("returns the caller's reports with status and replies", async () => {
    const res = await request(app).get(`/api/myreports?userId=${USER}`);

    expect(res.status).toBe(200);
    expect(res.body.reports[0]).toMatchObject({
      status: "open",
      message: "Attendance shows zero for my section",
    });
    expect(Object.keys(res.body.reports[0])).toContain("issueId");
  });

  it("opens the thread behind an issue and keeps the follow-up", async () => {
    const list = await request(app).get(`/api/myreports?userId=${USER}`);
    const issueId: string = list.body.reports[0].issueId;
    expect(list.body.reports[0].messageCount).toBe(1);

    const thread = await request(app).get(
      `/api/thread/${issueId}?userId=${USER}`,
    );
    expect(thread.status).toBe(200);
    expect(thread.body.thread.messages).toHaveLength(1);
    expect(thread.body.thread.messages[0]).toMatchObject({ author: "user" });

    const followUp = await request(app)
      .post(`/api/thread/${issueId}`)
      .send({ userId: USER, message: "Still wrong after the nightly sync" });
    expect(followUp.status).toBe(200);

    const after = await request(app).get(
      `/api/thread/${issueId}?userId=${USER}`,
    );
    expect(
      after.body.thread.messages.map((m: { author: string }) => m.author),
    ).toEqual(["user", "user"]);

    // the admin was pinged about the follow-up
    expect(
      sent.some(
        (s) =>
          s.to === process.env.ADMIN_ID &&
          s.text.includes("Still wrong after the nightly sync"),
      ),
    ).toBe(true);

    // and the reporter's own message is never "unread" to them
    const relisted = await request(app).get(`/api/myreports?userId=${USER}`);
    expect(relisted.body.reports[0].unread).toBe(0);
  });

  it("refuses to read or extend somebody else's thread", async () => {
    const list = await request(app).get(`/api/myreports?userId=${USER}`);
    const issueId: string = list.body.reports[0].issueId;

    const read = await request(app).get(`/api/thread/${issueId}?userId=999999`);
    expect(read.status).toBe(404);

    const write = await request(app)
      .post(`/api/thread/${issueId}`)
      .send({ userId: "999999", message: "Not my issue, but replying anyway" });
    expect(write.status).toBe(404);
  });

  it("rejects an empty thread message", async () => {
    const list = await request(app).get(`/api/myreports?userId=${USER}`);
    const issueId: string = list.body.reports[0].issueId;

    const res = await request(app)
      .post(`/api/thread/${issueId}`)
      .send({ userId: USER, message: "   " });
    expect(res.status).toBe(400);
  });

  it("closes the thread on resolve: follow-ups get a 410, nothing is stored", async () => {
    const { createReport, setReportStatus, formatIssueId } =
      await import("../../src/db/report.model.js");
    // filed straight into the DB: the HTTP filing limiter is already spent
    // by the earlier tests in this file
    const FRESH_USER = 424242;
    const id = await createReport(
      FRESH_USER,
      "This issue will be resolved soon",
    );
    const issueId = formatIssueId(id);
    await setReportStatus(id, "resolved");

    const write = await request(app)
      .post(`/api/thread/${issueId}`)
      .send({
        userId: String(FRESH_USER),
        message: "Trying to write on a closed thread",
      });
    expect(write.status).toBe(410);
    expect(write.body.ok).toBe(false);

    // nothing was appended and the admin was not pinged
    const thread = await request(app).get(
      `/api/thread/${issueId}?userId=${FRESH_USER}`,
    );
    expect(thread.body.thread.messages).toHaveLength(1);
    expect(
      sent.some((s) => s.text.includes("Trying to write on a closed thread")),
    ).toBe(false);
  });

  it("files screenshots with a report and serves them back", async () => {
    const res = await request(app)
      .post(`/api/report?userId=${SHOTS_USER}`)
      .field("message", "The marks table is blank in the second column")
      .attach("screenshots", PNG, {
        filename: "marks.png",
        contentType: "image/png",
      })
      .attach("screenshots", JPEG, {
        filename: "marks.jpg",
        contentType: "image/jpeg",
      })
      .attach("screenshots", WEBP, {
        filename: "marks.webp",
        contentType: "image/webp",
      });

    expect(res.status).toBe(200);
    const issueId: string = res.body.issueId;

    const adminNotice = sent.find(
      (s) => s.to === process.env.ADMIN_ID && s.text.includes(issueId),
    );
    expect(adminNotice?.text).toContain("3 screenshots");

    const thread = await request(app).get(
      `/api/thread/${issueId}?userId=${SHOTS_USER}`,
    );
    const attachments = thread.body.thread.messages[0].attachments as Array<{
      url: string;
      mimeType: string;
    }>;
    expect(attachments).toHaveLength(3);
    expect(attachments.map((a) => a.mimeType).sort()).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    const png = attachments.find((a) => a.mimeType === "image/png");
    expect(png?.url).toMatch(/^\/api\/report-attachment\/[a-f0-9]{32}\.png$/);

    const image = await request(app).get(png!.url);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toContain("image/png");
    expect(Buffer.from(image.body).equals(PNG)).toBe(true);

    const files = await readdir(uploadsDir);
    expect(files).toHaveLength(3);
    expect(files.some((name) => name.endsWith(".jpg"))).toBe(true);
    expect(files.some((name) => name.endsWith(".webp"))).toBe(true);
  });

  it("404s for an unknown attachment without caching the miss", async () => {
    const missing = await request(app).get(
      `/api/report-attachment/${"b".repeat(32)}.png`,
    );
    expect(missing.status).toBe(404);
    expect(missing.headers["content-type"]).toContain("application/json");
    expect(missing.headers["cache-control"]).toBe("no-store");

    const malformed = await request(app).get(
      "/api/report-attachment/not-a-name.png",
    );
    expect(malformed.status).toBe(404);
    expect(malformed.headers["cache-control"]).toBe("no-store");

    const traversal = await request(app).get(
      "/api/report-attachment/../../etc/passwd",
    );
    expect(traversal.status).toBe(404);
  });

  it("rejects a file that only claims to be an image", async () => {
    const res = await request(app)
      .post(`/api/report?userId=${SHOTS_USER}`)
      .field("message", "Attaching a file that is definitely not a screenshot")
      .attach("screenshots", Buffer.from("<html>not an image</html>"), {
        filename: "fake.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("PNG, JPEG or WebP");
  });

  it("rejects more than three screenshots", async () => {
    let pending = request(app)
      .post(`/api/report?userId=${SHOTS_USER}`)
      .field("message", "One screenshot too many on this report");
    for (let i = 0; i < 4; i++) {
      pending = pending.attach("screenshots", PNG, {
        filename: `shot-${i}.png`,
        contentType: "image/png",
      });
    }

    const res = await pending;
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("3 screenshots");
  });

  it("rejects a screenshot over five megabytes", async () => {
    const huge = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
    const res = await request(app)
      .post(`/api/report?userId=${SHOTS_USER}`)
      .field("message", "This screenshot is far too large to accept")
      .attach("screenshots", huge, {
        filename: "huge.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("5 MB");
  });

  it("discards uploaded screenshots when the report text is rejected", async () => {
    const before = await readdir(uploadsDir);

    const res = await request(app)
      .post(`/api/report?userId=${DISCARD_USER}`)
      .field("message", "short")
      .attach("screenshots", PNG, {
        filename: "short.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
    const after = await readdir(uploadsDir);
    expect(after.sort()).toEqual(before.sort());
  });

  it("accepts a screenshot-only follow-up", async () => {
    const list = await request(app).get(`/api/myreports?userId=${SHOTS_USER}`);
    const issueId: string = list.body.reports[0].issueId;

    const res = await request(app)
      .post(`/api/thread/${issueId}?userId=${SHOTS_USER}`)
      .field("message", "")
      .attach("screenshots", WEBP, {
        filename: "again.webp",
        contentType: "image/webp",
      });

    expect(res.status).toBe(200);

    const thread = await request(app).get(
      `/api/thread/${issueId}?userId=${SHOTS_USER}`,
    );
    const last = thread.body.thread.messages.at(-1) as {
      body: string;
      attachments: Array<{ mimeType: string }>;
    };
    expect(last.body).toBe("");
    expect(last.attachments).toHaveLength(1);
    expect(last.attachments[0].mimeType).toBe("image/webp");

    expect(
      sent.some(
        (s) =>
          s.to === process.env.ADMIN_ID &&
          s.text.includes("Sent 1 screenshot."),
      ),
    ).toBe(true);
  });

  it("still rejects an empty follow-up with no screenshots", async () => {
    const list = await request(app).get(`/api/myreports?userId=${SHOTS_USER}`);
    const issueId: string = list.body.reports[0].issueId;

    const res = await request(app)
      .post(`/api/thread/${issueId}?userId=${SHOTS_USER}`)
      .send({ userId: SHOTS_USER, message: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("screenshot");
  });

  it("discards a screenshot sent to a closed thread", async () => {
    const { createReport, setReportStatus, formatIssueId } =
      await import("../../src/db/report.model.js");
    const id = await createReport(
      7,
      "This thread will be closed before the screenshot arrives",
    );
    await setReportStatus(id, "resolved");

    const before = await readdir(uploadsDir);
    const res = await request(app)
      .post(`/api/thread/${formatIssueId(id)}?userId=7`)
      .field("message", "")
      .attach("screenshots", PNG, {
        filename: "too-late.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(410);
    const after = await readdir(uploadsDir);
    expect(after.sort()).toEqual(before.sort());
  });

  it("leaves no temporary upload directories behind", async () => {
    const names = await readdir(uploadsDir);
    expect(names.filter((name) => name.startsWith(".upload-"))).toEqual([]);
  });
});
