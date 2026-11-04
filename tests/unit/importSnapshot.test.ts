import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

/**
 * Smoke test for scripts/import-turso-snapshot.mjs. Builds a fake Turso
 * export with sqlite itself (no real Turso needed), runs the script against a
 * throwaway local database, and checks both the merge policy and the summary.
 */

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const scriptPath = path.join(repoRoot, "scripts/import-turso-snapshot.mjs");

const dir = mkdtempSync(path.join(tmpdir(), "qik-import-"));
const sourcePath = path.join(dir, "turso-export.db");
const localPath = path.join(dir, "qik.db");

const TABLES = [
  `CREATE TABLE IF NOT EXISTS studentsnew (
    roll_no TEXT PRIMARY KEY, name TEXT, section TEXT, branch TEXT, year TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS student_stats (
    roll_no TEXT PRIMARY KEY, attendance_percentage REAL,
    mid_marks_avg REAL, last_updated TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS library_documents (
    id TEXT PRIMARY KEY, code TEXT NOT NULL, title TEXT NOT NULL,
    dept TEXT NOT NULL, regulation TEXT NOT NULL, year_sem TEXT NOT NULL,
    unit TEXT, kind TEXT NOT NULL, source_path TEXT NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'coming_soon',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (code, unit, kind)
  )`,
  `CREATE TABLE IF NOT EXISTS library_reads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
    doc_id TEXT NOT NULL, page INTEGER NOT NULL, token TEXT,
    at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS uptime_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, component TEXT NOT NULL,
    status TEXT NOT NULL, latency_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

const makeSchema = async (client: Client) => {
  await client.batch(TABLES, "write");
};

const runImport = () => {
  const result = spawnSync(process.execPath, [scriptPath, sourcePath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, LOCAL_DB_URL: `file:${localPath}` },
  });
  return {
    status: result.status,
    out: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
};

const localRows = async (sql: string) => {
  const client = createClient({ url: `file:${localPath}` });
  try {
    return (await client.execute(sql)).rows;
  } finally {
    await client.close();
  }
};

beforeAll(async () => {
  const source = createClient({ url: `file:${sourcePath}` });
  await makeSchema(source);
  await source.batch(
    [
      `INSERT INTO studentsnew VALUES ('26KB1A0501', 'From Turso', 'C', '5', '31')`,
      `INSERT INTO studentsnew VALUES ('26KB1A0599', 'Only In Turso', 'D', '5', '31')`,
      `INSERT INTO student_stats VALUES ('26KB1A0501', 11.1, 10.0, '2026-01-01 00:00:00')`,
      `INSERT INTO student_stats VALUES ('26KB1A0599', 22.2, 20.0, '2026-01-01 00:00:00')`,
      `INSERT INTO library_documents
         (id, code, title, dept, regulation, year_sem, unit, kind, source_path, page_count, bytes, status)
       VALUES ('doc-1', 'CS301', 'Operating Systems', 'CSE', 'R23', '31', '1', 'material', '/srv/docs/cs301.pdf', 40, 1000, 'live')`,
      `INSERT INTO library_reads (user_id, doc_id, page, token, at)
       VALUES ('u1', 'doc-1', 1, 'tok-1', '2026-01-01 00:00:00')`,
      `INSERT INTO library_reads (user_id, doc_id, page, token, at)
       VALUES ('u2', 'doc-1', 2, 'tok-2', '2026-01-02 00:00:00')`,
      `INSERT INTO uptime_log (component, status, latency_ms, created_at)
       VALUES ('api', 'up', 12, '2026-01-01 00:00:00')`,
      `INSERT INTO uptime_log (component, status, latency_ms, created_at)
       VALUES ('api', 'up', 15, '2026-01-02 00:00:00')`,
    ],
    "write",
  );
  await source.close();

  const local = createClient({ url: `file:${localPath}` });
  await makeSchema(local);
  await local.batch(
    [
      `INSERT INTO studentsnew VALUES ('26KB1A0501', 'Local Wins', 'A', '5', '31')`,
      `INSERT INTO student_stats VALUES ('26KB1A0501', 99.9, 90.0, '2026-03-01 00:00:00')`,
      `INSERT INTO uptime_log (component, status, latency_ms, created_at)
       VALUES ('api', 'up', 9, '2026-01-01 00:00:00')`,
    ],
    "write",
  );
  await local.close();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("import-turso-snapshot", () => {
  it("merges the new tables, keeps local rows, and skips missing source tables", async () => {
    const { status, out } = runImport();

    expect(out).toContain("studentsnew");
    expect(out).toContain("library_documents");
    expect(out).toContain("library_reads");
    expect(out).toContain("not present in the source export");
    expect(out).toContain("Merge complete");
    expect(status).toBe(0);

    // local students win; a student only in the export is filled in
    const students = await localRows(
      "SELECT roll_no, name, section FROM studentsnew ORDER BY roll_no",
    );
    expect(
      students.map((row) => [
        String(row.roll_no),
        String(row.name),
        String(row.section),
      ]),
    ).toEqual([
      ["26KB1A0501", "Local Wins", "A"],
      ["26KB1A0599", "Only In Turso", "D"],
    ]);

    // same for stats: the locally rebuilt row is not overwritten
    const stats = await localRows(
      "SELECT roll_no, attendance_percentage FROM student_stats ORDER BY roll_no",
    );
    expect(
      stats.map((row) => [
        String(row.roll_no),
        Number(row.attendance_percentage),
      ]),
    ).toEqual([
      ["26KB1A0501", 99.9],
      ["26KB1A0599", 22.2],
    ]);

    const docs = await localRows("SELECT COUNT(*) AS n FROM library_documents");
    expect(Number(docs[0].n)).toBe(1);
    const reads = await localRows("SELECT COUNT(*) AS n FROM library_reads");
    expect(Number(reads[0].n)).toBe(2);

    // natural key on uptime_log: the duplicate is skipped, the new day lands
    const uptime = await localRows("SELECT COUNT(*) AS n FROM uptime_log");
    expect(Number(uptime[0].n)).toBe(2);
  });

  it("keeps the local library trail on a re-run instead of failing", async () => {
    const local = createClient({ url: `file:${localPath}` });
    await local.execute(
      `INSERT INTO library_reads (user_id, doc_id, page, token)
       VALUES ('u3', 'doc-1', 3, 'tok-3')`,
    );
    await local.close();

    const { status, out } = runImport();

    expect(out).toContain("keeping the local trail");
    expect(out).toContain("Merge complete");
    expect(status).toBe(0);

    const reads = await localRows("SELECT COUNT(*) AS n FROM library_reads");
    expect(Number(reads[0].n)).toBe(3);
  });
});
