import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createClient } from "@libsql/client";

/**
 * The verification routes end to end: identity, the emailed code, the claim,
 * the ownership lock on registration and the hide switch. SMTP is mocked so
 * no mail leaves the test box; the database is real.
 */
const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

const sent = vi.hoisted(() => ({ codes: [] as string[], to: [] as string[] }));

vi.mock("../../src/services/verification/email.js", () => ({
  EmailNotConfiguredError: class EmailNotConfiguredError extends Error {},
  sendVerificationCode: vi.fn(async (to: string, code: string) => {
    sent.to.push(to);
    sent.codes.push(code);
  }),
}));

vi.mock("../../src/services/redis/utils.js", () => ({
  StudentNotFoundError: class StudentNotFoundError extends Error {},
  getStudentCached: vi.fn(async (roll: string) => ({
    roll_no: roll.toUpperCase(),
    name: "TEST STUDENT",
    section: "A",
    branch: "5",
    year: "31",
  })),
}));

vi.mock("../../src/services/library/entitlement.js", () => ({
  invalidateStudentContext: vi.fn(),
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
      `CREATE TABLE roll_claims (
        roll_no TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        verified_at TEXT NOT NULL DEFAULT (datetime('now')),
        blocked INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE email_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        roll_no TEXT NOT NULL,
        email TEXT NOT NULL,
        code_salt TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      )`,
    ],
    "write",
  );
});

const { app } = await import("../../src/api/server.js");

const OWNER = "1000000001";
const OTHER = "1000000002";
const ROLL = "99KB9A9999";

const as = (userId: string) => `userId=${userId}`;

describe("verification API", () => {
  it("mails the code for the roll's college address", async () => {
    const res = await request(app)
      .post(`/api/verification/start?${as(OWNER)}`)
      .send({ rollNo: ROLL });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      email: "99kb9a9999@nbkrist.org",
    });
    expect(sent.to).toContain("99kb9a9999@nbkrist.org");
    expect(sent.codes.at(-1)).toMatch(/^\d{6}$/);
  });

  it("rejects a wrong code", async () => {
    const res = await request(app)
      .post(`/api/verification/confirm?${as(OWNER)}`)
      .send({ rollNo: ROLL, code: "000000" });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("claims the roll and reports the verified state", async () => {
    const code = sent.codes.at(-1) as string;
    const res = await request(app)
      .post(`/api/verification/confirm?${as(OWNER)}`)
      .send({ rollNo: ROLL, code });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      verified: true,
      roll: ROLL,
      blocked: false,
    });

    const state = await request(app).get(`/api/verification?${as(OWNER)}`);
    expect(state.body.verified).toBe(true);
  });

  it("refuses the roll to every other account", async () => {
    const res = await request(app)
      .post(`/api/register?${as(OTHER)}`)
      .send({ rollNo: ROLL, displayName: "OTHER" });

    expect(res.status).toBe(403);
  });

  it("lets the owner register it", async () => {
    const res = await request(app)
      .post(`/api/register?${as(OWNER)}`)
      .send({ rollNo: ROLL, displayName: "OWNER" });

    expect(res.status).toBe(200);
  });

  it("hides and restores the roll with the owner's switch", async () => {
    const hide = await request(app)
      .post(`/api/verification/block?${as(OWNER)}`)
      .send({ blocked: true });
    expect(hide.body).toMatchObject({ ok: true, blocked: true });

    const show = await request(app)
      .post(`/api/verification/block?${as(OWNER)}`)
      .send({ blocked: false });
    expect(show.body).toMatchObject({ ok: true, blocked: false });
  });
});
