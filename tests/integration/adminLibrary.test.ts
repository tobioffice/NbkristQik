import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { createClient } from "@libsql/client";

process.env.ADMIN_PANEL_PATH = "test-panel";
process.env.ADMIN_PANEL_PASSWORD = "test-password";

const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

const { app } = await import("../../src/api/server.js");
const { tokenHash } = await import("../../src/api/admin/auth.js");

const BASE = "/test-panel";
const PASSWORD = "test-password";

const authCookie = async (): Promise<string> => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  await client.execute({
    sql: `INSERT INTO admin_sessions (token_hash, expires_at)
          VALUES (?, datetime('now', '+1 hour'))`,
    args: [tokenHash(rawToken, PASSWORD)],
  });
  return `qik_admin=${rawToken}`;
};

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
      `CREATE TABLE registrations (userId TEXT PRIMARY KEY, roll_no TEXT NOT NULL, display_name TEXT)`,
      `CREATE TABLE studentsnew (roll_no TEXT PRIMARY KEY, name TEXT, section TEXT, branch TEXT, year TEXT)`,
      `CREATE TABLE library_documents (
        id TEXT PRIMARY KEY, code TEXT NOT NULL, title TEXT NOT NULL, dept TEXT NOT NULL,
        regulation TEXT NOT NULL, year_sem TEXT NOT NULL, unit TEXT, kind TEXT NOT NULL,
        source_path TEXT NOT NULL, page_count INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'coming_soon', version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT, updated_at TEXT)`,
      `CREATE TABLE library_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, doc_id TEXT NOT NULL,
        page INTEGER NOT NULL, token TEXT, surface TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`,
      `INSERT INTO botusers VALUES (42, 'alice', 'Alice', datetime('now'), datetime('now'), 1, 0, 0, 1)`,
      `INSERT INTO registrations VALUES ('42', '23CS1042', NULL)`,
      `INSERT INTO studentsnew VALUES ('23CS1042', 'ALICE TEST', 'A', '5', '31')`,
      `INSERT INTO library_documents
         (id, code, title, dept, regulation, year_sem, unit, kind, source_path, page_count, status)
        VALUES ('doc1', 'CS101', 'Networks', 'CSE', 'R23', '31', 'I', 'material', 'x.pdf', 10, 'live')`,
      `INSERT INTO library_reads (user_id, doc_id, page, token, surface) VALUES ('42', 'doc1', 1, 'NBK-AAAA-BBBB-CCCC-DDDD', 'telegram')`,
      `INSERT INTO library_reads (user_id, doc_id, page, token, surface) VALUES ('42', 'doc1', 2, 'NBK-AAAA-BBBB-CCCC-DDDD', 'telegram')`,
      `INSERT INTO library_reads (user_id, doc_id, page, token, surface) VALUES ('42', 'doc1', 0, 'NBK-AAAA-BBBB-CCCC-DDDD', 'pc')`,
    ],
    "write",
  );
});

describe("admin library tab", () => {
  it("rejects unauthed callers", async () => {
    const res = await request(app).get(`${BASE}/api/library/summary`);
    expect(res.status).toBe(401);
  });

  it("serves summary, readers, documents, recent and resolve for an authed caller", async () => {
    const cookie = await authCookie();

    const summary = await request(app)
      .get(`${BASE}/api/library/summary`)
      .set("Cookie", cookie);
    expect(summary.status).toBe(200);
    expect(summary.body.readers).toBe(1);
    expect(summary.body.pagesRead).toBe(2);
    expect(summary.body.pdfDownloads).toBe(1);
    expect(summary.body.pcReads).toBe(1);
    expect(summary.body.telegramReads).toBe(2);

    const readers = await request(app)
      .get(`${BASE}/api/library/readers?q=23CS`)
      .set("Cookie", cookie);
    expect(readers.status).toBe(200);
    expect(readers.body.readers).toHaveLength(1);
    expect(readers.body.readers[0]).toEqual(
      expect.objectContaining({
        userId: "42",
        rollNo: "23CS1042",
        pagesRead: 2,
        pdfDownloads: 1,
      }),
    );

    const docs = await request(app)
      .get(`${BASE}/api/library/documents`)
      .set("Cookie", cookie);
    expect(docs.status).toBe(200);
    expect(docs.body.documents[0]).toEqual(
      expect.objectContaining({
        docId: "doc1",
        readers: 1,
        pagesRead: 2,
        pdfDownloads: 1,
      }),
    );
    expect(docs.body.documents[0].completionPct).toBe(20);

    const recent = await request(app)
      .get(`${BASE}/api/library/recent?limit=10`)
      .set("Cookie", cookie);
    expect(recent.status).toBe(200);
    expect(recent.body.events).toHaveLength(3);
    expect(recent.body.events[0].page).toBe(0);

    const detail = await request(app)
      .get(`${BASE}/api/library/readers/42`)
      .set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.reader.userId).toBe("42");
    expect(detail.body.docs).toHaveLength(1);
    expect(detail.body.docs[0].completionPct).toBe(20);

    const bad = await request(app)
      .get(`${BASE}/api/library/resolve?token=not-a-token`)
      .set("Cookie", cookie);
    expect(bad.status).toBe(400);

    const resolved = await request(app)
      .get(`${BASE}/api/library/resolve?token=NBK-AAAA-BBBB-CCCC-DDDD`)
      .set("Cookie", cookie);
    expect(resolved.status).toBe(200);
    expect(resolved.body.reads).toHaveLength(3);

    const missing = await request(app)
      .get(`${BASE}/api/library/resolve?token=NBK-0000-0000-0000-0000`)
      .set("Cookie", cookie);
    expect(missing.status).toBe(404);
  });

  it("lists the Library tab in the panel shell and JS", async () => {
    const shell = await request(app).get(BASE);
    expect(shell.status).toBe(200);
    expect(shell.text).toContain('data-view="library"');
    expect(shell.text).toContain('id="view-library"');
    expect(shell.text).toContain("library/readers");
    expect(shell.text).toContain("libresolve");
  });
});
