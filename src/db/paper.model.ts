import { turso } from "./db.js";

/**
 * The question-paper collection.
 *
 * One submission is one row in `question_papers` plus one row per page in
 * `question_paper_images`. The files themselves live under PAPER_FILES_DIR
 * (data/papers by default); these rows are the authoritative list and own
 * their lifetime. Students do not browse each other's uploads: the only read
 * path is the private admin list, where the papers are processed.
 */

export interface PaperRow {
  id: number;
  user_id: number;
  subject: string;
  exam: string;
  note: string | null;
  created_at: string;
}

/** A file already written to disk, waiting for the paper row that owns it. */
export interface NewPaperImage {
  fileName: string;
  mimeType: string;
  byteSize: number;
}

export interface AdminPaperSummary extends PaperRow {
  page_count: number;
  /** Stored file names, oldest page first. */
  image_file_names: string[];
  name: string | null;
  username: string | null;
}

/** Creates the collection's tables; called once by initDatabase(). */
export const initPaperTables = async (): Promise<void> => {
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS question_papers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        exam TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS question_paper_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id INTEGER NOT NULL,
        file_name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_question_papers_created
       ON question_papers (created_at);`,
  );
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_question_papers_user
       ON question_papers (user_id, created_at);`,
  );
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_question_paper_images_paper
       ON question_paper_images (paper_id, position, id);`,
  );
};

const toRow = (row: Record<string, unknown>): PaperRow => ({
  id: Number(row.id),
  user_id: Number(row.user_id),
  subject: String(row.subject),
  exam: String(row.exam),
  note: row.note ? String(row.note) : null,
  created_at: String(row.created_at),
});

/**
 * Insert one paper and its pages atomically. A crash between the head and the
 * images must not leave a paper with a missing page.
 */
export const createPaper = async (
  userId: number,
  subject: string,
  exam: string,
  note: string | null,
  images: NewPaperImage[],
): Promise<number> => {
  const tx = await turso.transaction("write");
  try {
    const result = await tx.execute({
      sql: `INSERT INTO question_papers (user_id, subject, exam, note)
            VALUES (?, ?, ?, ?)`,
      args: [userId, subject, exam, note],
    });
    const id = Number(result.lastInsertRowid);
    let position = 0;
    for (const image of images) {
      await tx.execute({
        sql: `INSERT INTO question_paper_images
                (paper_id, file_name, mime_type, byte_size, position)
              VALUES (?, ?, ?, ?, ?)`,
        args: [id, image.fileName, image.mimeType, image.byteSize, position++],
      });
    }
    await tx.commit();
    return id;
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  }
};

/**
 * Delete a submission and its page rows, returning the file names to unlink.
 * The caller is the admin only; there is no public read or delete path.
 */
export const deletePaper = async (
  id: number,
): Promise<{ fileNames: string[] } | null> => {
  const tx = await turso.transaction("write");
  try {
    const found = await tx.execute({
      sql: `SELECT q.id, i.file_name
            FROM question_papers q
            LEFT JOIN question_paper_images i ON i.paper_id = q.id
            WHERE q.id = ?
            ORDER BY i.position, i.id`,
      args: [id],
    });
    if (found.rows.length === 0) {
      await tx.rollback();
      return null;
    }

    const fileNames = found.rows
      .map((row) => (row.file_name ? String(row.file_name) : ""))
      .filter(Boolean);

    await tx.execute({
      sql: `DELETE FROM question_paper_images WHERE paper_id = ?`,
      args: [id],
    });
    await tx.execute({
      sql: `DELETE FROM question_papers WHERE id = ?`,
      args: [id],
    });
    await tx.commit();
    return { fileNames };
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  }
};

/** Admin list: newest first, with the uploader's Telegram profile and pages. */
export const listPapersForAdmin = async (
  limit = 200,
): Promise<AdminPaperSummary[]> => {
  const n = Math.min(Math.max(limit, 1), 500);
  const [heads, images] = await turso.batch(
    [
      {
        sql: `SELECT p.id, p.user_id, p.subject, p.exam, p.note, p.created_at,
                     u.first_name AS name, u.username,
                     (SELECT COUNT(*) FROM question_paper_images i
                       WHERE i.paper_id = p.id) AS page_count
              FROM question_papers p
              LEFT JOIN botusers u ON u.user_id = p.user_id
              ORDER BY p.id DESC LIMIT ?`,
        args: [n],
      },
      {
        sql: `SELECT i.paper_id, i.file_name
              FROM question_paper_images i
              WHERE i.paper_id IN (
                SELECT id FROM question_papers ORDER BY id DESC LIMIT ?
              )
              ORDER BY i.paper_id DESC, i.position, i.id`,
        args: [n],
      },
    ],
    "read",
  );

  const pages = new Map<number, string[]>();
  for (const row of images.rows) {
    const paperId = Number(row.paper_id);
    const list = pages.get(paperId);
    if (list) list.push(String(row.file_name));
    else pages.set(paperId, [String(row.file_name)]);
  }

  return heads.rows.map((row) => {
    const paper = toRow(row);
    return {
      ...paper,
      page_count: Number(row.page_count ?? 0),
      image_file_names: pages.get(paper.id) ?? [],
      name: row.name ? String(row.name) : null,
      username: row.username ? String(row.username) : null,
    };
  });
};
