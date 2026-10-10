import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import { createClient } from "@libsql/client";

// in-memory Turso shared by the whole file process
const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    expire: vi.fn(async () => 1),
  })),
}));

vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
  trackMessage: vi.fn(),
}));

beforeAll(async () => {
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
      `INSERT INTO studentsnew VALUES ('26KB5A0218', 'BILLE PRANTH', '-', '2', '21')`,
      `INSERT INTO studentsnew VALUES ('26KB5A0219', 'TEST NEIGHBOUR', '-', '2', '21')`,
      `CREATE TABLE tgusers (userId TEXT PRIMARY KEY, rollNo TEXT)`,
      `INSERT INTO tgusers VALUES ('111222333', '26KB5A0219')`,
    ],
    "write",
  );
});

const { app } = await import("../../src/api/server.js");
const { upsertRegistration, getRegistration } = await import(
  "../../src/db/registration.model.js"
);

// test env keeps the dev userId shortcut available (ENV !== production)
const ME = "444555666";

describe("registration model", () => {
  it("inserts and reads a registration", async () => {
    await upsertRegistration(ME, "26kb5a0218", "Prasanth");
    const reg = await getRegistration(ME);

    expect(reg?.roll_no).toBe("26KB5A0218");
    expect(reg?.display_name).toBe("Prasanth");
    expect(reg?.registered_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("updates on conflict, keeping registered_at", async () => {
    await upsertRegistration(ME, "26KB5A0218", "Prasanth");
    const first = await getRegistration(ME);

    // wait a beat so datetime('now') differs
    await new Promise((r) => setTimeout(r, 1100));
    await upsertRegistration(ME, "26KB5A0219", null);
    const second = await getRegistration(ME);

    expect(second?.roll_no).toBe("26KB5A0219");
    expect(second?.display_name).toBeNull();
    expect(second?.registered_at).toBe(first?.registered_at);
    expect(second?.updated_at >= first!.updated_at).toBe(true);
  });

  it("returns null for unknown users", async () => {
    expect(await getRegistration("000999888777")).toBeNull();
  });
});

describe("profile endpoints", () => {
  it("GET /api/profile without identity is rejected", async () => {
    const res = await request(app).get("/api/profile");

    expect(res.status).toBe(401);
    expect(res.body.found).toBe(false);
  });

  it("GET /api/profile suggests the past-lookup roll for unregistered users", async () => {
    const res = await request(app).get("/api/profile?userId=111222333");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ found: false, suggestion: "26KB5A0219" });
  });

  it("POST /api/register validates the roll format", async () => {
    const res = await request(app)
      .post("/api/register")
      .send({ userId: ME, rollNo: "bad-roll" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/doesn't look right/i);
  });

  it("POST /api/register rejects unknown rolls with suggestions, without saving", async () => {
    const fresh = "777888999";
    const res = await request(app)
      .post("/api/register")
      .send({ userId: fresh, rollNo: "26KB5A0299" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/isn't in the college records/i);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    // nothing was written
    expect(await getRegistration(fresh)).toBeNull();
  });

  it("POST /api/register stores the registration and GET returns it", async () => {
    const post = await request(app)
      .post("/api/register")
      .send({ userId: ME, rollNo: "26kb5a0218", displayName: "  Prasanth  " });

    expect(post.status).toBe(200);
    expect(post.body).toMatchObject({
      ok: true,
      registered: { roll_no: "26KB5A0218" },
    });

    const get = await request(app).get(`/api/profile?userId=${ME}`);
    expect(get.status).toBe(200);
    expect(get.body.found).toBe(true);
    expect(get.body.registration).toMatchObject({
      roll_no: "26KB5A0218",
      display_name: "Prasanth", // trimmed; no angle brackets to strip
    });
    expect(get.body.student).toMatchObject({ section: "-", branch: "2" });
  });

  it("there is no delete endpoint", async () => {
    const res = await request(app).delete(`/api/register`).send({ userId: ME });

    expect(res.status).toBe(404);
  });
});
