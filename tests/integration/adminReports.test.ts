import { describe, it, expect, beforeAll, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";
import { createClient } from "@libsql/client";

process.env.ADMIN_PANEL_PATH = "panels-test";
process.env.ADMIN_PANEL_PASSWORD = "panel-pass";

const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
  })),
}));

const sentTo: Array<{ to: string; text: string }> = [];
vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    sendMessage: vi.fn(async (to: string, text: string) => {
      sentTo.push({ to: String(to), text });
      return { message_id: sentTo.length };
    }),
  },
}));

const { app } = await import("../../src/api/server.js");
const { createReport, formatIssueId } = await import(
  "../../src/db/report.model.js"
);

const PASSWORD = "panel-pass";
const BASE = "/panels-test";
const cookie = `qik_admin=${encodeURIComponent("test-admin-token")}`;

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
      `INSERT INTO botusers VALUES (7, 'bobby', 'Bobby')`,
      `CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, created_at TEXT, expires_at TEXT)`,
    ],
    "write",
  );

  // session the same way the login route stores it
  await client.execute({
    sql: `INSERT INTO admin_sessions (token_hash, expires_at)
          VALUES (?, datetime('now', '+1 hour'))`,
    args: [
      crypto
        .createHmac("sha256", PASSWORD)
        .update("test-admin-token")
        .digest("hex"),
    ],
  });
});

describe("admin reports endpoints", () => {
  it("rejects unauthenticated access", async () => {
    const res = await request(app).get(`${BASE}/api/reports`);
    expect(res.status).toBe(401);
  });

  it("lists reports with names, newest first, honoring the status filter", async () => {
    await createReport(7, "The bunk plan math looks wrong to me");
    await createReport(999, "No data for my roll at all");

    const all = await request(app)
      .get(`${BASE}/api/reports?status=all`)
      .set("Cookie", cookie);
    expect(all.status).toBe(200);
    expect(all.body.reports[0].issueId).toMatch(/^QIK-\d{4}$/);
    expect(
      all.body.reports.find((r: { userId: number }) => r.userId === 7)?.name,
    ).toBe("Bobby");

    const open = await request(app)
      .get(`${BASE}/api/reports?status=open`)
      .set("Cookie", cookie);
    expect(
      open.body.reports.every((r: { status: string }) => r.status === "open"),
    ).toBe(true);
  });

  it("records a reply via the panel and DMs the reporter", async () => {
    const id = await createReport(7, "Attendance percentages are wrong");
    const res = await request(app)
      .post(`${BASE}/api/reports/${id}/reply`)
      .set("Cookie", cookie)
      .send({ reply: "College fixed it, check again." });

    expect(res.status).toBe(200);
    // the reporter was DM'd
    expect(sentTo.find((s) => s.to === "7")?.text).toContain(
      "College fixed it",
    );

    const answered = await request(app)
      .get(`${BASE}/api/reports?status=answered`)
      .set("Cookie", cookie);
    expect(
      answered.body.reports.some(
        (r: { adminReply: string }) =>
          r.adminReply === "College fixed it, check again.",
      ),
    ).toBe(true);
  });

  it("closes a report via the panel", async () => {
    const id = await createReport(7, "Duplicate issue, closing it");
    const res = await request(app)
      .post(`${BASE}/api/reports/${id}/close`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    const resolved = await request(app)
      .get(`${BASE}/api/reports?status=resolved`)
      .set("Cookie", cookie);
    expect(
      resolved.body.reports.some(
        (r: { issueId: string }) => r.issueId === formatIssueId(id),
      ),
    ).toBe(true);
  });

  it("404s on unknown report ids and 400s on empty replies", async () => {
    const missing = await request(app)
      .post(`${BASE}/api/reports/999999/reply`)
      .set("Cookie", cookie)
      .send({ reply: "hello" });
    expect(missing.status).toBe(404);

    const empty = await request(app)
      .post(`${BASE}/api/reports/1/reply`)
      .set("Cookie", cookie)
      .send({ reply: "" });
    expect(empty.status).toBe(400);
  });
});
