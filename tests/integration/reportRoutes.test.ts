import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import { createClient } from "@libsql/client";
import TelegramBot from "node-telegram-bot-api";

process.env.ADMIN_ID = "1329532701";
process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";
void TelegramBot;

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
    sendMessage: vi.fn(async (to: string, text: string) => {
      sent.push({ to: String(to), text });
      return { message_id: sent.length };
    }),
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
      `CREATE TABLE botusers (user_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT)`,
      `INSERT INTO botusers VALUES (6407457375, 'prasanth', 'PRASANTH')`,
    ],
    "write",
  );
});

const { app } = await import("../../src/api/server.js");

const USER = "6407457375";

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
});
