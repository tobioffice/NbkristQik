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
});
