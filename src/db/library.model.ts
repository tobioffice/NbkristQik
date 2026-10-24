import { turso } from "./db.js";

/**
 * The library registry.
 *
 * One row per document we hold (a subject unit, or a whole subject). The
 * files themselves live on the server's disk; this table is only the index:
 * which subject, which unit, how many pages, and where the pages live.
 *
 * `library_reads` is the audit trail: one row per page a student was served.
 * It is what a takedown is argued from, and what the bulk-pull detector
 * counts.
 */

export type LibraryDocumentKind = "material" | "assignment";
export type LibraryDocumentStatus = "live" | "coming_soon";

export interface LibraryDocument {
  id: string;
  code: string;
  title: string;
  dept: string;
  regulation: string;
  year_sem: string;
  unit: string | null;
  kind: LibraryDocumentKind;
  source_path: string;
  page_count: number;
  bytes: number;
  status: LibraryDocumentStatus;
  version: number;
}

export const initLibraryTables = async (): Promise<void> => {
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS library_documents (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        dept TEXT NOT NULL,
        regulation TEXT NOT NULL,
        year_sem TEXT NOT NULL,
        unit TEXT,
        kind TEXT NOT NULL,
        source_path TEXT NOT NULL,
        page_count INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'coming_soon',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (code, unit, kind)
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS library_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        page INTEGER NOT NULL,
        token TEXT,
        at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_library_reads_user ON library_reads (user_id, at);`,
  );
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_library_reads_doc ON library_reads (doc_id, at);`,
  );
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_library_reads_token ON library_reads (token);`,
  );
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_library_documents_code ON library_documents (code);`,
  );
};

const toDocument = (row: Record<string, unknown>): LibraryDocument => ({
  id: String(row.id),
  code: String(row.code),
  title: String(row.title),
  dept: String(row.dept),
  regulation: String(row.regulation),
  year_sem: String(row.year_sem),
  unit: row.unit ? String(row.unit) : null,
  kind: String(row.kind) as LibraryDocumentKind,
  source_path: String(row.source_path),
  page_count: Number(row.page_count ?? 0),
  bytes: Number(row.bytes ?? 0),
  status: String(row.status) as LibraryDocumentStatus,
  version: Number(row.version ?? 1),
});

const toDocuments = (rows: Record<string, unknown>[]): LibraryDocument[] =>
  rows.map(toDocument);

/** Inserts or replaces a document row. */
export const upsertLibraryDocument = async (
  doc: LibraryDocument,
): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO library_documents
            (id, code, title, dept, regulation, year_sem, unit, kind,
             source_path, page_count, bytes, status, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            source_path = excluded.source_path,
            page_count = excluded.page_count,
            bytes = excluded.bytes,
            status = excluded.status,
            version = excluded.version,
            updated_at = datetime('now')`,
    args: [
      doc.id,
      doc.code,
      doc.title,
      doc.dept,
      doc.regulation,
      doc.year_sem,
      doc.unit,
      doc.kind,
      doc.source_path,
      doc.page_count,
      doc.bytes,
      doc.status,
      doc.version,
    ],
  });
};

export const getLibraryDocument = async (
  id: string,
): Promise<LibraryDocument | null> => {
  const result = await turso.execute({
    sql: `SELECT * FROM library_documents WHERE id = ?`,
    args: [id],
  });
  const row = result.rows[0];
  return row ? toDocument(row as Record<string, unknown>) : null;
};

/** The live documents of one department, regulation and year-sem. */
export const listLiveDocumentsForSemester = async (
  dept: string,
  regulation: string,
  yearSem: string,
): Promise<LibraryDocument[]> => {
  const result = await turso.execute({
    sql: `SELECT * FROM library_documents
          WHERE status = 'live' AND dept = ? AND regulation = ? AND year_sem = ?
          ORDER BY code, unit`,
    args: [dept, regulation, yearSem],
  });
  return toDocuments(result.rows as Record<string, unknown>[]);
};

/**
 * Every live document, whatever the semester.
 *
 * Only the admin's preview asks for this: while the library is still closed
 * the admin sees the whole shelf, not just the subjects of their own year.
 */
export const listLiveLibraryDocuments = async (): Promise<
  LibraryDocument[]
> => {
  const result = await turso.execute(
    `SELECT * FROM library_documents WHERE status = 'live' ORDER BY code, unit`,
  );
  return toDocuments(result.rows as Record<string, unknown>[]);
};

/** Records one page delivery. Fire and forget. */
export const recordLibraryRead = async (
  userId: string,
  docId: string,
  page: number,
  token?: string,
): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO library_reads (user_id, doc_id, page, token)
          VALUES (?, ?, ?, ?)`,
    args: [userId, docId, page, token ?? null],
  });
};

/**
 * The reads behind one watermark token. This is how a leaked page becomes a
 * name: the token on the picture is looked up here.
 */
export const findReadsByToken = async (
  token: string,
): Promise<
  { user_id: string; doc_id: string; page: number; at: string; count: number }[]
> => {
  const result = await turso.execute({
    sql: `SELECT user_id, doc_id, MIN(page) AS page, MIN(at) AS at, COUNT(*) AS n
          FROM library_reads WHERE token = ?
          GROUP BY user_id, doc_id`,
    args: [token],
  });
  return result.rows.map((row) => ({
    user_id: String(row.user_id),
    doc_id: String(row.doc_id),
    page: Number(row.page ?? 0),
    at: String(row.at ?? ""),
    count: Number(row.n ?? 0),
  }));
};
