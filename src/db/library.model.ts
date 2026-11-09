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
        surface TEXT,
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
  surface?: "telegram" | "pc",
): Promise<void> => {
  if (!surface) {
    await turso.execute({
      sql: `INSERT INTO library_reads (user_id, doc_id, page, token)
            VALUES (?, ?, ?, ?)`,
      args: [userId, docId, page, token ?? null],
    });
    return;
  }
  try {
    await turso.execute({
      sql: `INSERT INTO library_reads (user_id, doc_id, page, token, surface)
            VALUES (?, ?, ?, ?, ?)`,
      args: [userId, docId, page, token ?? null, surface],
    });
  } catch (e) {
    // a database that has not run the v3 migration yet has no surface
    // column in its manually-created test tables; fall back so reads
    // still record, and the column stays best-effort telemetry
    if (
      !/no such column|no column named/i.test(
        String((e as Error)?.message ?? e),
      )
    )
      throw e;
    await turso.execute({
      sql: `INSERT INTO library_reads (user_id, doc_id, page, token)
            VALUES (?, ?, ?, ?)`,
      args: [userId, docId, page, token ?? null],
    });
  }
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

/* ------------------------------------------------------------------ */
/* Admin Library analytics (used by the admin Library tab).            */
/* Registration pins identity; tgusers is only a last-lookup hint.     */
/* ------------------------------------------------------------------ */

export interface LibraryReader {
  userId: string;
  username: string | null;
  firstName: string | null;
  rollNo: string | null;
  displayName: string | null;
  collegeName: string | null;
  branch: string | null;
  section: string | null;
  docsRead: number;
  pagesRead: number;
  pdfDownloads: number;
  firstAt: string;
  lastAt: string;
}

const toReader = (r: Record<string, unknown>): LibraryReader => ({
  userId: String(r.user_id),
  username: r.username ? String(r.username) : null,
  firstName: r.first_name ? String(r.first_name) : null,
  rollNo: r.roll_no ? String(r.roll_no) : null,
  displayName: r.display_name ? String(r.display_name) : null,
  collegeName: r.college_name ? String(r.college_name) : null,
  branch: r.branch ? String(r.branch) : null,
  section: r.section ? String(r.section) : null,
  docsRead: Number(r.docs_read),
  pagesRead: Number(r.pages_read),
  pdfDownloads: Number(r.pdf_downloads),
  firstAt: String(r.first_at),
  lastAt: String(r.last_at),
});

const READER_SELECT = `SELECT r.user_id,
        u.username, u.first_name,
        reg.roll_no, reg.display_name, s.name AS college_name,
        s.branch, s.section,
        COUNT(DISTINCT r.doc_id) AS docs_read,
        SUM(CASE WHEN r.page > 0 THEN 1 ELSE 0 END) AS pages_read,
        SUM(CASE WHEN r.page = 0 THEN 1 ELSE 0 END) AS pdf_downloads,
        MIN(r.at) AS first_at, MAX(r.at) AS last_at
      FROM library_reads r
      LEFT JOIN botusers u ON u.user_id = CAST(r.user_id AS INTEGER)
      LEFT JOIN registrations reg ON reg.userId = r.user_id
      LEFT JOIN studentsnew s ON s.roll_no = reg.roll_no`;

export const listLibraryReaders = async (
  q: string,
  sort: "recent" | "pages" | "downloads",
  limit: number,
): Promise<{ readers: LibraryReader[] }> => {
  const trim = q.trim();
  const where = trim
    ? ` WHERE r.user_id LIKE ? OR u.username LIKE ? OR u.first_name LIKE ?
         OR COALESCE(reg.roll_no, '') LIKE ? OR COALESCE(s.name, '') LIKE ?
         OR COALESCE(reg.display_name, '') LIKE ?`
    : "";
  const like = `%${trim}%`;
  const orderBy =
    sort === "pages"
      ? "pages_read DESC, last_at DESC"
      : sort === "downloads"
        ? "pdf_downloads DESC, last_at DESC"
        : "last_at DESC";
  const args = trim ? [like, like, like, like, like, like, limit] : [limit];
  const result = await turso.execute({
    sql: `${READER_SELECT}${where}
          GROUP BY r.user_id
          ORDER BY ${orderBy}
          LIMIT ?`,
    args,
  });
  return {
    readers: result.rows.map((r) => toReader(r as Record<string, unknown>)),
  };
};

export const getLibraryReader = async (
  userId: string,
): Promise<LibraryReader | null> => {
  const result = await turso.execute({
    sql: `${READER_SELECT} WHERE r.user_id = ? GROUP BY r.user_id`,
    args: [userId],
  });
  return result.rows[0]
    ? toReader(result.rows[0] as Record<string, unknown>)
    : null;
};

export interface LibraryDocumentStat {
  docId: string;
  code: string;
  title: string;
  unit: string | null;
  dept: string;
  yearSem: string;
  pageCount: number;
  readers: number;
  pagesRead: number;
  pdfDownloads: number;
  completionPct: number;
  firstAt: string;
  lastAt: string;
}

export const listLibraryDocumentStats = async (): Promise<{
  documents: LibraryDocumentStat[];
}> => {
  const result = await turso.execute({
    sql: `SELECT d.id AS doc_id, d.code, d.title, d.unit, d.dept, d.year_sem,
            d.page_count,
            COUNT(DISTINCT r.user_id) AS readers,
            SUM(CASE WHEN r.page > 0 THEN 1 ELSE 0 END) AS pages_read,
            SUM(CASE WHEN r.page = 0 THEN 1 ELSE 0 END) AS pdf_downloads,
            MIN(r.at) AS first_at, MAX(r.at) AS last_at
          FROM library_documents d
          JOIN library_reads r ON r.doc_id = d.id
          GROUP BY d.id
          ORDER BY readers DESC, pages_read DESC`,
  });
  return {
    documents: result.rows.map((row) => {
      const pageCount = Number(
        (row as Record<string, unknown>).page_count ?? 0,
      );
      const readers = Number((row as Record<string, unknown>).readers ?? 0);
      const pagesRead = Number(
        (row as Record<string, unknown>).pages_read ?? 0,
      );
      const completionPct =
        readers > 0 && pageCount > 0
          ? Math.min(100, Math.round((pagesRead / (readers * pageCount)) * 100))
          : 0;
      return {
        docId: String((row as Record<string, unknown>).doc_id),
        code: String((row as Record<string, unknown>).code),
        title: String((row as Record<string, unknown>).title),
        unit: (row as Record<string, unknown>).unit
          ? String((row as Record<string, unknown>).unit)
          : null,
        dept: String((row as Record<string, unknown>).dept),
        yearSem: String((row as Record<string, unknown>).year_sem),
        pageCount,
        readers,
        pagesRead,
        pdfDownloads: Number(
          (row as Record<string, unknown>).pdf_downloads ?? 0,
        ),
        completionPct,
        firstAt: String((row as Record<string, unknown>).first_at ?? ""),
        lastAt: String((row as Record<string, unknown>).last_at ?? ""),
      };
    }),
  };
};

export const listRecentLibraryReads = async (limit: number) => {
  const result = await turso.execute({
    sql: `SELECT r.user_id, r.doc_id, r.page, r.token, r.at,
            COALESCE(r.surface, 'telegram') AS surface,
            d.code, d.title, d.unit,
            u.username, u.first_name,
            reg.roll_no, reg.display_name, s.name AS college_name
          FROM library_reads r
          LEFT JOIN library_documents d ON d.id = r.doc_id
          LEFT JOIN botusers u ON u.user_id = CAST(r.user_id AS INTEGER)
          LEFT JOIN registrations reg ON reg.userId = r.user_id
          LEFT JOIN studentsnew s ON s.roll_no = reg.roll_no
          ORDER BY r.at DESC, r.id DESC
          LIMIT ?`,
    args: [limit],
  });
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      userId: String(r.user_id),
      docId: String(r.doc_id),
      page: Number(r.page),
      token: r.token ? String(r.token) : null,
      surface: String(r.surface),
      at: String(r.at),
      code: r.code ? String(r.code) : null,
      title: r.title ? String(r.title) : null,
      unit: r.unit ? String(r.unit) : null,
      username: r.username ? String(r.username) : null,
      firstName: r.first_name ? String(r.first_name) : null,
      rollNo: r.roll_no ? String(r.roll_no) : null,
      displayName: r.display_name ? String(r.display_name) : null,
      collegeName: r.college_name ? String(r.college_name) : null,
    };
  });
};

export const getLibrarySummary = async () => {
  const [summary, daily] = await turso.batch(
    [
      {
        sql: `SELECT COUNT(DISTINCT user_id) AS readers,
                SUM(CASE WHEN page > 0 THEN 1 ELSE 0 END) AS pages_read,
                SUM(CASE WHEN page = 0 THEN 1 ELSE 0 END) AS pdf_downloads,
                COUNT(DISTINCT doc_id) AS docs,
                COALESCE(SUM(CASE WHEN COALESCE(surface, 'telegram') = 'pc' THEN 1 ELSE 0 END), 0) AS pc_reads,
                COALESCE(SUM(CASE WHEN COALESCE(surface, 'telegram') = 'telegram' THEN 1 ELSE 0 END), 0) AS telegram_reads,
                MIN(at) AS first_at, MAX(at) AS last_at,
                (SELECT COUNT(DISTINCT user_id) FROM library_reads WHERE at >= datetime('now', '-1 day')) AS readers_1d,
                (SELECT COUNT(DISTINCT user_id) FROM library_reads WHERE at >= datetime('now', '-7 days')) AS readers_7d,
                (SELECT COUNT(DISTINCT user_id) FROM library_reads WHERE at >= datetime('now', '-30 days')) AS readers_30d
              FROM library_reads`,
        args: [],
      },
      {
        sql: `SELECT date(at, '+330 minutes') AS d,
                COUNT(*) AS n,
                COUNT(DISTINCT user_id) AS users,
                SUM(CASE WHEN page = 0 THEN 1 ELSE 0 END) AS downloads
              FROM library_reads
              WHERE at >= datetime('now', '-30 days')
              GROUP BY d ORDER BY d`,
        args: [],
      },
    ],
    "read",
  );
  const s = summary.rows[0] as Record<string, unknown> | undefined;
  return {
    readers: Number(s?.readers ?? 0),
    pagesRead: Number(s?.pages_read ?? 0),
    pdfDownloads: Number(s?.pdf_downloads ?? 0),
    docs: Number(s?.docs ?? 0),
    pcReads: Number(s?.pc_reads ?? 0),
    telegramReads: Number(s?.telegram_reads ?? 0),
    firstAt: s?.first_at ? String(s.first_at) : null,
    lastAt: s?.last_at ? String(s.last_at) : null,
    readers1d: Number(s?.readers_1d ?? 0),
    readers7d: Number(s?.readers_7d ?? 0),
    readers30d: Number(s?.readers_30d ?? 0),
    daily: daily.rows.map((r) => ({
      day: String((r as Record<string, unknown>).d),
      reads: Number((r as Record<string, unknown>).n),
      users: Number((r as Record<string, unknown>).users),
      downloads: Number((r as Record<string, unknown>).downloads),
    })),
  };
};

export const getReaderLibraryDetail = async (userId: string) => {
  const [docs, daily, recent] = await turso.batch(
    [
      {
        sql: `SELECT d.id AS doc_id, d.code, d.title, d.unit, d.page_count,
                COUNT(CASE WHEN r.page > 0 THEN 1 END) AS pages_read,
                COUNT(DISTINCT CASE WHEN r.page > 0 THEN r.page END) AS distinct_pages,
                SUM(CASE WHEN r.page = 0 THEN 1 ELSE 0 END) AS pdf_downloads,
                MIN(r.at) AS first_at, MAX(r.at) AS last_at
              FROM library_reads r
              LEFT JOIN library_documents d ON d.id = r.doc_id
              WHERE r.user_id = ?
              GROUP BY r.doc_id
              ORDER BY last_at DESC`,
        args: [userId],
      },
      {
        sql: `SELECT date(at, '+330 minutes') AS d,
                COUNT(*) AS n,
                SUM(CASE WHEN page = 0 THEN 1 ELSE 0 END) AS downloads
              FROM library_reads
              WHERE user_id = ? AND at >= datetime('now', '-30 days')
              GROUP BY d ORDER BY d`,
        args: [userId],
      },
      {
        sql: `SELECT r.page, r.token, r.at, COALESCE(r.surface, 'telegram') AS surface,
                d.code, d.title, d.unit
              FROM library_reads r
              LEFT JOIN library_documents d ON d.id = r.doc_id
              WHERE r.user_id = ?
              ORDER BY r.at DESC, r.id DESC
              LIMIT 20`,
        args: [userId],
      },
    ],
    "read",
  );
  return {
    docs: docs.rows.map((row) => {
      const r = row as Record<string, unknown>;
      const pageCount = Number(r.page_count ?? 0);
      const distinct = Number(r.distinct_pages ?? 0);
      const completionPct =
        pageCount > 0
          ? Math.min(100, Math.round((distinct / pageCount) * 100))
          : 0;
      return {
        docId: String(r.doc_id),
        code: r.code ? String(r.code) : null,
        title: r.title ? String(r.title) : null,
        unit: r.unit ? String(r.unit) : null,
        pageCount,
        pagesRead: Number(r.pages_read ?? 0),
        distinctPages: distinct,
        pdfDownloads: Number(r.pdf_downloads ?? 0),
        completionPct,
        firstAt: String(r.first_at ?? ""),
        lastAt: String(r.last_at ?? ""),
      };
    }),
    daily: daily.rows.map((r) => ({
      day: String((r as Record<string, unknown>).d),
      reads: Number((r as Record<string, unknown>).n),
      downloads: Number((r as Record<string, unknown>).downloads),
    })),
    recent: recent.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        page: Number(row.page),
        token: row.token ? String(row.token) : null,
        at: String(row.at),
        surface: String(row.surface),
        code: row.code ? String(row.code) : null,
        title: row.title ? String(row.title) : null,
        unit: row.unit ? String(row.unit) : null,
      };
    }),
  };
};

export const resolveLibraryToken = async (token: string) => {
  const result = await turso.execute({
    sql: `SELECT r.user_id, r.doc_id, r.page, r.at, COALESCE(r.surface, 'telegram') AS surface,
            d.code, d.title, d.unit,
            u.username, u.first_name,
            reg.roll_no, reg.display_name, s.name AS college_name
          FROM library_reads r
          LEFT JOIN library_documents d ON d.id = r.doc_id
          LEFT JOIN botusers u ON u.user_id = CAST(r.user_id AS INTEGER)
          LEFT JOIN registrations reg ON reg.userId = r.user_id
          LEFT JOIN studentsnew s ON s.roll_no = reg.roll_no
          WHERE r.token = ?
          ORDER BY r.at ASC`,
    args: [token],
  });
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      userId: String(r.user_id),
      docId: String(r.doc_id),
      page: Number(r.page),
      at: String(r.at),
      surface: String(r.surface),
      code: r.code ? String(r.code) : null,
      title: r.title ? String(r.title) : null,
      unit: r.unit ? String(r.unit) : null,
      username: r.username ? String(r.username) : null,
      firstName: r.first_name ? String(r.first_name) : null,
      rollNo: r.roll_no ? String(r.roll_no) : null,
      displayName: r.display_name ? String(r.display_name) : null,
      collegeName: r.college_name ? String(r.college_name) : null,
    };
  });
};
