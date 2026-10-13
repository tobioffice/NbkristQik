import { describe, it, expect, beforeAll, vi } from "vitest";
import { createClient } from "@libsql/client";

const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

const {
  createReport,
  getReport,
  addReportMessage,
  appendUserThreadMessage,
  getReportThread,
  listReportMessages,
  markReportRead,
  recordAdminReply,
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

describe("report threads", () => {
  it("seeds the thread with the opening message", async () => {
    const id = await createReport(42, "Opening message of the thread");
    const messages = await listReportMessages(id);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      author: "user",
      body: "Opening message of the thread",
    });
  });

  it("keeps both sides in order and tracks unread counts", async () => {
    const id = await createReport(42, "Nothing loads on the marks page");
    await addReportMessage(id, "admin", "Which roll number?");

    const messages = await listReportMessages(id);
    expect(messages.map((m) => m.author)).toEqual(["user", "admin"]);

    // the reporter has not opened the thread: the admin's message is unseen
    const [mine] = await listUserReports(42);
    expect(mine.id).toBe(id);
    expect(mine.message_count).toBe(2);
    expect(mine.last_author).toBe("admin");
    expect(mine.unread).toBe(1);

    await markReportRead(id, "user", messages[1].id);
    expect((await listUserReports(42))[0].unread).toBe(0);

    // the admin side counts the reporter's follow-up the same way
    await markReportRead(id, "admin", messages[1].id);
    await addReportMessage(id, "user", "Roll 23BQ1A0501");
    const row = (await listReports(null, 50)).find((r) => r.id === id);
    expect(row?.unread).toBe(1);

    // reading again never moves the marker backwards
    await markReportRead(id, "user", messages[0].id);
    expect((await listUserReports(42))[0].unread).toBe(1);
  });

  it("reads a conversation and both markers in a single query", async () => {
    const id = await createReport(42, "Single round trip thread read");
    await addReportMessage(id, "admin", "Answer arrives");

    const mine = await getReportThread(id, "user");
    expect(mine?.messages.map((m) => `${m.author}:${m.body}`)).toEqual([
      "user:Single round trip thread read",
      "admin:Answer arrives",
    ]);
    expect(mine?.last_seen_id).toBe(mine?.messages[0].id); // own opening is read
    expect(mine?.last_seen_id).toBeGreaterThan(0);

    const admin = await getReportThread(id, "admin");
    expect(admin?.last_seen_id).toBe(0); // the admin has not opened it yet
    expect(await getReportThread(999999, "user")).toBeNull();
  });

  it("appends a user follow-up with marker and reopen in one batch", async () => {
    const id = await createReport(42, "Batched follow-up starts here");
    await setReportStatus(id, "resolved");

    await appendUserThreadMessage(id, "It broke again after the fix", true);

    const row = await getReport(id);
    expect(row?.status).toBe("open");
    const messages = await listReportMessages(id);
    expect(messages[messages.length - 1]?.body).toBe(
      "It broke again after the fix",
    );
    // the author has obviously read their own message
    const [mine] = await listUserReports(42);
    expect(mine.unread).toBe(0);
  });

  it("records an admin reply with the legacy columns and its own marker", async () => {
    const id = await createReport(42, "Batched admin reply lands here");

    await recordAdminReply(id, "Fixed, check now");

    const row = await getReport(id);
    expect(row?.status).toBe("answered");
    expect(row?.admin_reply).toBe("Fixed, check now");
    expect(row?.replied_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    // the admin's own reply never counts as unread to the admin
    const admin = await getReportThread(id, "admin");
    expect(admin?.last_seen_id).toBe(
      admin?.messages[admin.messages.length - 1].id,
    );
    const listed = (await listReports(null, 50)).find((r) => r.id === id);
    expect(listed?.unread).toBe(0);
    // ...but it is news to the reporter
    const [mine] = await listUserReports(42);
    expect(mine.unread).toBe(1);
  });

  it("lists reports in a single batched round trip, not N subqueries", async () => {
    const executeSpy = vi.spyOn(client, "execute");
    const batchSpy = vi.spyOn(client, "batch");
    try {
      await listReports(null, 10);
      await listUserReports(42, 5);
      // one batch (which ships several statements together) per list, and
      // zero standalone round trips
      expect(batchSpy).toHaveBeenCalledTimes(2);
      expect(executeSpy).not.toHaveBeenCalled();
    } finally {
      executeSpy.mockRestore();
      batchSpy.mockRestore();
    }
  });
});
