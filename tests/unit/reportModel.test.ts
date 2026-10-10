import { describe, it, expect, beforeAll, vi } from "vitest";
import { createClient } from "@libsql/client";

const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

const {
  createReport,
  getReport,
  replyReport,
  setReportStatus,
  listUserReports,
  listReports,
  formatIssueId,
  parseIssueId,
} = await import("../../src/db/report.model.js");

beforeAll(async () => {
  await client.batch(
    [
      `CREATE TABLE reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        admin_reply TEXT,
        replied_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE botusers (user_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT)`,
      `INSERT INTO botusers VALUES (42, 'alice', 'Alice')`,
    ],
    "write",
  );
});

describe("formatIssueId / parseIssueId", () => {
  it("zero-pads to four digits", () => {
    expect(formatIssueId(7)).toBe("QIK-0007");
    expect(formatIssueId(1042)).toBe("QIK-1042");
  });

  it("parses with or without the prefix, rejecting junk", () => {
    expect(parseIssueId("QIK-0007")).toBe(7);
    expect(parseIssueId("qik-7")).toBe(7);
    expect(parseIssueId("12")).toBe(12);
    expect(parseIssueId("BUG-001")).toBeNull();
    expect(parseIssueId("abc")).toBeNull();
  });
});

describe("report lifecycle", () => {
  it("creates a report and reads it back", async () => {
    const id = await createReport(42, "Marks show wrong for DCMT");
    const row = await getReport(id);

    expect(row?.status).toBe("open");
    expect(row?.message).toBe("Marks show wrong for DCMT");
    expect(row?.admin_reply).toBeNull();
  });

  it("records a reply and flips to answered", async () => {
    const id = await createReport(42, "Attendance not loading");

    const changed = await replyReport(
      id,
      "Fixed on the college side, check again.",
    );
    expect(changed).toBe(true);

    const row = await getReport(id);
    expect(row?.status).toBe("answered");
    expect(row?.admin_reply).toBe("Fixed on the college side, check again.");
    expect(row?.replied_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("closes an issue without erasing the reply", async () => {
    const id = await createReport(42, "Can nobody see my attendance?");

    await replyReport(id, "Looks fine on the portal.");
    const closed = await setReportStatus(id, "resolved");
    expect(closed).toBe(true);

    const row = await getReport(id);
    expect(row?.status).toBe("resolved");
    expect(row?.admin_reply).toBe("Looks fine on the portal.");
  });

  it("lists a user's reports newest first and the admin listing joins names", async () => {
    const first = await createReport(42, "one two three four five six");
    const second = await createReport(42, "two two two the second one");
    const stranger = await createReport(999, "nobody hears me at all");

    // newest first for the caller, only their own rows
    const mine = await listUserReports(42);
    expect(mine[0].id).toBe(second);
    expect(mine.every((r) => r.user_id === 42)).toBe(true);

    // admin listing joins botusers; a user without a botusers row still shows
    const adminList = await listReports(null, 50);
    expect(adminList.find((r) => r.id === stranger)?.name).toBeNull();
    expect(adminList.find((r) => r.id === first)?.name).toBe("Alice");

    // status filters work
    await replyReport(second, "here you go");
    const openOnly = await listReports("open", 50);
    expect(openOnly.every((r) => r.status === "open")).toBe(true);
    expect(openOnly.find((r) => r.id === second)).toBeUndefined();
  });
});
