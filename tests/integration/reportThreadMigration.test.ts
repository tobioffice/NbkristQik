import { describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";

// A database that predates report threads: reports carry the opening message
// and at most one admin_reply; report_messages/report_reads do not exist yet.
const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

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
    `INSERT INTO reports (user_id, message, status, admin_reply, replied_at)
     VALUES (11, 'Legacy report body', 'answered', 'Admin answered this', datetime('now'))`,
    `INSERT INTO reports (user_id, message) VALUES (12, 'Never answered by anyone')`,
  ],
  "write",
);

const { initDatabase } = await import("../../src/db/init.js");
await initDatabase();

describe("report thread migration", () => {
  it("replays pre-thread reports and seeds the reporter's read marker", async () => {
    const messages = await client.execute(
      `SELECT report_id, author, body FROM report_messages ORDER BY id`,
    );
    // statement order: every opening message is seeded first, then the legacy
    // replies — per report the order still reads oldest first
    expect(
      messages.rows.map((r) => `${r.report_id}:${String(r.author)}`),
    ).toEqual(["1:user", "2:user", "1:admin"]);
    expect(String(messages.rows[2].body)).toBe("Admin answered this");

    // nothing is left behind without a thread
    const orphan = await client.execute(
      `SELECT COUNT(*) AS n FROM reports r
       WHERE NOT EXISTS (SELECT 1 FROM report_messages m WHERE m.report_id = r.id)`,
    );
    expect(Number(orphan.rows[0].n)).toBe(0);

    // the opening messages are read by their authors; the old admin reply
    // (message 3, above report 1's marker) stays unseen
    const markers = await client.execute(
      `SELECT report_id AS id, last_seen_id AS seen FROM report_reads
       WHERE reader = 'user' ORDER BY report_id`,
    );
    expect(markers.rows.map((r) => Number(r.seen))).toEqual([1, 2]);

    const { listUserReports } = await import("../../src/db/report.model.js");
    const legacy = (await listUserReports(11))[0]; // answered before threads
    const fresh = (await listUserReports(12))[0]; // never answered
    expect(legacy.unread).toBe(1); // the admin's old reply is still news
    expect(fresh.unread).toBe(0); // their own opening message is not
    expect(fresh.message_count).toBe(1);
  });

  it("is idempotent — a second boot adds nothing", async () => {
    await initDatabase();

    const counts = await client.execute(
      `SELECT (SELECT COUNT(*) FROM report_messages) AS messages,
              (SELECT COUNT(*) FROM report_reads) AS reads`,
    );
    expect(Number(counts.rows[0].messages)).toBe(3);
    expect(Number(counts.rows[0].reads)).toBe(2);
  });
});
