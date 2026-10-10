import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { createClient } from "@libsql/client";

process.env.ADMIN_PANEL_PATH = "test-panel";
process.env.ADMIN_PANEL_PASSWORD = "test-password";

// Admin routes resolve the Turso client at import time, so point the module
// at an in-memory libSQL database and create the tables it queries.
const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

const { app } = await import("../../src/api/server.js");
const { tokenHash } = await import("../../src/api/admin/auth.js");

const BASE = "/test-panel";
const PASSWORD = "test-password";

beforeAll(async () => {
  await client.batch(
    [
      `CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, created_at TEXT, expires_at TEXT)`,
      `CREATE TABLE botusers (user_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT,
         first_seen TEXT, last_seen TEXT, private_actions INTEGER, channel_actions INTEGER,
         group_actions INTEGER, total_actions INTEGER)`,
      `CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
         chat_type TEXT, action TEXT, detail TEXT, created_at TEXT)`,
      `CREATE TABLE tgusers (userId TEXT PRIMARY KEY, rollNo TEXT)`,
      `CREATE TABLE uptime_log (id INTEGER PRIMARY KEY AUTOINCREMENT, component TEXT,
         status TEXT, latency_ms INTEGER, created_at TEXT)`,
    ],
    "write",
  );
});

describe("admin routes", () => {
  it("serves the login shell without auth but rejects data endpoints", async () => {
    const shell = await request(app).get(BASE);
    expect(shell.status).toBe(200);
    expect(shell.text).toContain("Qik");

    const overview = await request(app).get(`${BASE}/api/overview`);
    expect(overview.status).toBe(401);
  });

  it("rejects wrong passwords and accepts the right one", async () => {
    const wrong = await request(app)
      .post(`${BASE}/login`)
      .send({ password: "nope" });
    expect(wrong.status).toBe(401);

    const ok = await request(app)
      .post(`${BASE}/login`)
      .send({ password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.headers["set-cookie"]?.[0]).toContain("qik_admin=");
  });

  it("accepts a session cookie with an unexpired stored hash", async () => {
    // insert a session directly (as the login route would)
    const rawToken = crypto.randomBytes(32).toString("hex");
    await client.execute({
      sql: `INSERT INTO admin_sessions (token_hash, expires_at)
            VALUES (?, datetime('now', '+1 hour'))`,
      args: [tokenHash(rawToken, PASSWORD)],
    });

    const res = await request(app)
      .get(`${BASE}/api/overview`)
      .set("Cookie", `qik_admin=${rawToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totals).toBeDefined();
  });

  it("rejects an expired session", async () => {
    const rawToken = crypto.randomBytes(32).toString("hex");
    await client.execute({
      sql: `INSERT INTO admin_sessions (token_hash, expires_at)
            VALUES (?, datetime('now', '-1 hour'))`,
      args: [tokenHash(rawToken, PASSWORD)],
    });

    const res = await request(app)
      .get(`${BASE}/api/overview`)
      .set("Cookie", `qik_admin=${rawToken}`);

    expect(res.status).toBe(401);
  });

  it("serves the users table and per-user detail for an authed caller", async () => {
    await client.execute(
      `INSERT INTO botusers VALUES (5, 'alice', 'Alice', datetime('now'), datetime('now'), 1, 0, 2, 3)`,
    );
    const rawToken = crypto.randomBytes(32).toString("hex");
    await client.execute({
      sql: `INSERT INTO admin_sessions (token_hash, expires_at)
            VALUES (?, datetime('now', '+1 hour'))`,
      args: [tokenHash(rawToken, PASSWORD)],
    });
    const cookie = `qik_admin=${rawToken}`;

    const users = await request(app)
      .get(`${BASE}/api/users`)
      .set("Cookie", cookie);
    expect(users.status).toBe(200);
    expect(users.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 5, username: "alice" }),
      ]),
    );

    const detail = await request(app)
      .get(`${BASE}/api/users/5`)
      .set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.profile.userId).toBe(5);

    const missing = await request(app)
      .get(`${BASE}/api/users/999`)
      .set("Cookie", cookie);
    expect(missing.status).toBe(404);

    const bad = await request(app)
      .get(`${BASE}/api/users/abc`)
      .set("Cookie", cookie);
    expect(bad.status).toBe(400);
  });
});
