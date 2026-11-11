import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";

/**
 * College-email verification: the code goes only to `<roll>@nbkrist.org`,
 * confirming it claims the roll, terminates other registrations and unlocks
 * the hide switch. SMTP and the student cache are mocked; the DB is real.
 */
const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

const sent = vi.hoisted(() => ({ to: [] as string[], codes: [] as string[] }));

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
  })),
}));

vi.mock("../../src/services/library/entitlement.js", () => ({
  invalidateStudentContext: vi.fn(),
}));

const {
  startEmailVerification,
  confirmEmailVerification,
  getVerificationState,
  setVerificationOptions,
  isLookupBlockedForViewer,
  isRegistrationBlockedFor,
  VerificationError,
} = await import("../../src/services/verification/otp.js");

const ROLL = "99KB9A9999";
const OWNER = "1000000001";
const OTHER = "1000000002";

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
        hide_leaderboard INTEGER NOT NULL DEFAULT 0,
        block_lookups INTEGER NOT NULL DEFAULT 0,
        block_registration INTEGER NOT NULL DEFAULT 0,
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
      `INSERT INTO registrations (userId, roll_no, display_name)
       VALUES ('${OWNER}', '98KB9A0000', 'OWNER'), ('${OTHER}', '${ROLL}', 'OTHER')`,
    ],
    "write",
  );
});

// The tests below are one sequence: send a code, then try it. The live code
// is kept here rather than re-sent, because the resend guard is one a minute.
let liveCode = "";

describe("college-email verification", () => {
  it("sends the code only to the roll's college address", async () => {
    const result = await startEmailVerification(OWNER, ROLL.toLowerCase());

    expect(result.email).toBe("99kb9a9999@nbkrist.org");
    expect(sent.to).toEqual(["99kb9a9999@nbkrist.org"]);
    expect(sent.codes[0]).toMatch(/^\d{6}$/);
    liveCode = sent.codes[0];
  });

  it("rate-limits a second code within a minute", async () => {
    await expect(startEmailVerification(OWNER, ROLL)).rejects.toMatchObject({
      status: 429,
    });
  });

  it("rejects a wrong code and keeps the claim unset", async () => {
    const wrong = liveCode === "000000" ? "000001" : "000000";
    await expect(
      confirmEmailVerification(OWNER, ROLL, wrong),
    ).rejects.toBeInstanceOf(VerificationError);

    expect(await getVerificationState(OWNER)).toMatchObject({
      verified: false,
    });
  });

  it("claims the roll, terminates the other registration and sets the owner's roll", async () => {
    const state = await confirmEmailVerification(OWNER, ROLL, liveCode);

    expect(state).toEqual({
      verified: true,
      roll: ROLL,
      email: "99kb9a9999@nbkrist.org",
      blocked: false,
      hideLeaderboard: false,
      blockLookups: false,
      blockRegistration: false,
    });

    const other = await client.execute({
      sql: "SELECT roll_no FROM registrations WHERE userId = ?",
      args: [OTHER],
    });
    expect(other.rows).toHaveLength(0);

    const owner = await client.execute({
      sql: "SELECT roll_no FROM registrations WHERE userId = ?",
      args: [OWNER],
    });
    expect(String(owner.rows[0].roll_no)).toBe(ROLL);
  });

  it("leaves registration open until the owner restricts it", async () => {
    expect(await isRegistrationBlockedFor(ROLL, OTHER)).toBe(false);

    const state = await setVerificationOptions(OWNER, {
      hideLeaderboard: false,
      blockLookups: false,
      blockRegistration: true,
    });
    expect(state.blockRegistration).toBe(true);

    expect(await isRegistrationBlockedFor(ROLL, OTHER)).toBe(true);
    expect(await isRegistrationBlockedFor(ROLL, OWNER)).toBe(false);
  });

  it("stops other lookups only when that switch is on", async () => {
    // registration is still restricted from the previous test; the lookup
    // switch is independent and starts off
    expect(await isLookupBlockedForViewer(ROLL, OTHER)).toBe(false);

    const state = await setVerificationOptions(OWNER, {
      hideLeaderboard: false,
      blockLookups: true,
      blockRegistration: true,
    });
    expect(state.blockLookups).toBe(true);

    expect(await isLookupBlockedForViewer(ROLL, OTHER)).toBe(true);
    expect(await isLookupBlockedForViewer(ROLL, OWNER)).toBe(false);
    // the service admin keeps access
    expect(await isLookupBlockedForViewer(ROLL, "123456789")).toBe(false);
  });

  it("hides from the leaderboard only when that switch is on", async () => {
    const on = await setVerificationOptions(OWNER, {
      hideLeaderboard: true,
      blockLookups: false,
      blockRegistration: false,
    });
    expect(on.hideLeaderboard).toBe(true);

    const row = await client.execute(
      `SELECT hide_leaderboard, block_lookups, block_registration, blocked
       FROM roll_claims WHERE roll_no = ?`,
      [ROLL],
    );
    expect({
      hide: Number(row.rows[0].hide_leaderboard),
      lookups: Number(row.rows[0].block_lookups),
      registration: Number(row.rows[0].block_registration),
      any: Number(row.rows[0].blocked),
    }).toEqual({ hide: 1, lookups: 0, registration: 0, any: 1 });
  });
});
