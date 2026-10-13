import { turso } from "./db.js";

/**
 * Issue reports. Every report gets a stable, human-friendly issue id
 * (QIK-0007) the reporter and the admin can reference in chat.
 *
 * A report is a thread: the opening message and every follow-up from either
 * side live in report_messages, oldest first. The admin answers from the
 * panel (or /reply), the reporter answers on the report page, and each side
 * is pinged in Telegram when the other writes. The original `message` and
 * `admin_reply` columns stay in sync so older clients keep working.
 *
 * Statuses: open (the admin owes an answer) -> answered (the admin replied)
 * -> resolved (closed). A new reporter message reopens the thread.
 */

export type ReportStatus = "open" | "answered" | "resolved";

/** Who wrote a message in a report thread. */
export type MessageAuthor = "user" | "admin";

export interface ReportRow {
  id: number;
  user_id: number;
  message: string;
  status: ReportStatus;
  admin_reply: string | null;
  replied_at: string | null;
  created_at: string;
  /** thread roll-up, filled by the list queries (defaults fit a fresh report) */
  message_count: number;
  last_author: MessageAuthor;
  last_message_at: string;
  unread: number;
}

export interface ReportMessageRow {
  id: number;
  report_id: number;
  author: MessageAuthor;
  body: string;
  created_at: string;
}

/** Human-friendly issue id: QIK-0007 (zero-padded to 4). */
export const formatIssueId = (id: number): string =>
  `QIK-${String(id).padStart(4, "0")}`;

/** Accepts "QIK-0007", "QIK-7", or "7"; returns the numeric id or null. */
export const parseIssueId = (raw: string): number | null => {
  const m = raw
    .trim()
    .toUpperCase()
    .match(/^(?:QIK-)?(\d{1,6})$/);
  return m ? Number(m[1]) : null;
};

const toRow = (row: Record<string, unknown>): ReportRow => ({
  id: Number(row.id),
  user_id: Number(row.user_id),
  message: String(row.message),
  status: String(row.status) as ReportStatus,
  admin_reply: row.admin_reply ? String(row.admin_reply) : null,
  replied_at: row.replied_at ? String(row.replied_at) : null,
  created_at: String(row.created_at),
  message_count: Number(row.message_count ?? 1),
  last_author: (row.last_author
    ? String(row.last_author)
    : "user") as MessageAuthor,
  last_message_at: row.last_message_at
    ? String(row.last_message_at)
    : String(row.created_at),
  unread: Number(row.unread ?? 0),
});

/**
 * Thread roll-up without correlated subqueries. The previous version embedded
 * four correlated subselects per listed row; with the DB ~250 ms away and
 * the panel re-listing on a timer, every poll paid that per row. Instead the
 * list head, the messages behind exactly those reports, and the reader's
 * markers travel in one batched read (a single round trip, like the overview
 * query) and the roll-up is computed here. Message bodies stay out — the
 * list only needs counts, the last author/time, and the unread stamp.
 */
interface ThreadRollup {
  count: number;
  lastAuthor: MessageAuthor;
  lastAt: string;
  unread: number;
}

const rollUpThreads = (
  messageRows: Array<Record<string, unknown>>,
  markerRows: Array<Record<string, unknown>>,
): Map<number, ThreadRollup> => {
  const ids = new Map<number, number[]>();
  const last = new Map<
    number,
    { id: number; author: MessageAuthor; at: string }
  >();
  for (const row of messageRows) {
    const rid = Number(row.report_id);
    const id = Number(row.id);
    const list = ids.get(rid);
    if (list) list.push(id);
    else ids.set(rid, [id]);
    const cur = last.get(rid);
    if (!cur || id > cur.id) {
      last.set(rid, {
        id,
        author: String(row.author) as MessageAuthor,
        at: String(row.created_at),
      });
    }
  }
  const markers = new Map<number, number>();
  for (const row of markerRows) {
    markers.set(Number(row.report_id), Number(row.last_seen_id));
  }

  const out = new Map<number, ThreadRollup>();
  for (const [rid, list] of ids) {
    const marker = markers.get(rid) ?? 0;
    let unread = 0;
    for (const id of list) if (id > marker) unread++;
    const l = last.get(rid);
    out.set(rid, {
      count: list.length,
      lastAuthor: l ? l.author : "user",
      lastAt: l ? l.at : "",
      unread,
    });
  }
  return out;
};

/** Appends one message to a report's thread; returns the message id. */
export const addReportMessage = async (
  reportId: number,
  author: MessageAuthor,
  body: string,
): Promise<number> => {
  const result = await turso.execute({
    sql: `INSERT INTO report_messages (report_id, author, body) VALUES (?, ?, ?)`,
    args: [reportId, author, body],
  });
  return Number(result.lastInsertRowid);
};

export const createReport = async (
  userId: number,
  message: string,
): Promise<number> => {
  const result = await turso.execute({
    sql: `INSERT INTO reports (user_id, message) VALUES (?, ?)`,
    args: [userId, message],
  });
  const id = Number(result.lastInsertRowid);
  // the opening message is the first entry of the conversation, and its
  // author has obviously already read it
  const messageId = await addReportMessage(id, "user", message);
  await markReportRead(id, "user", messageId);
  return id;
};

export const getReport = async (id: number): Promise<ReportRow | null> => {
  const result = await turso.execute({
    sql: `SELECT id, user_id, message, status, admin_reply, replied_at, created_at
          FROM reports WHERE id = ?`,
    args: [id],
  });
  return result.rows[0] ? toRow(result.rows[0]) : null;
};

/** Whole conversation, oldest first (keeps the newest `limit` when long). */
export const listReportMessages = async (
  reportId: number,
  limit = 200,
): Promise<ReportMessageRow[]> => {
  const result = await turso.execute({
    sql: `SELECT * FROM (
            SELECT id, report_id, author, body, created_at
            FROM report_messages WHERE report_id = ?
            ORDER BY id DESC LIMIT ?
          ) ORDER BY id ASC`,
    args: [reportId, Math.min(Math.max(limit, 1), 500)],
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    report_id: Number(row.report_id),
    author: String(row.author) as MessageAuthor,
    body: String(row.body),
    created_at: String(row.created_at),
  }));
};

/** Moves a reader's marker forward (never backwards). */
export const markReportRead = async (
  reportId: number,
  reader: MessageAuthor,
  upToId: number,
): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO report_reads (report_id, reader, last_seen_id, seen_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(report_id, reader) DO UPDATE SET
            last_seen_id = MAX(report_reads.last_seen_id, excluded.last_seen_id),
            seen_at = excluded.seen_at`,
    args: [reportId, reader, upToId],
  });
};

export const listUserReports = async (
  userId: number,
  limit = 20,
): Promise<ReportRow[]> => {
  const n = Math.min(Math.max(limit, 1), 50);
  const listedIds = `SELECT id FROM reports WHERE user_id = ?
                     ORDER BY id DESC LIMIT ?`;
  const [heads, messages, markers] = await turso.batch(
    [
      {
        sql: `SELECT id, user_id, message, status, admin_reply, replied_at, created_at
              FROM reports WHERE user_id = ?
              ORDER BY id DESC LIMIT ?`,
        args: [userId, n],
      },
      {
        sql: `SELECT report_id, id, author, created_at
              FROM report_messages WHERE report_id IN (${listedIds})
              ORDER BY report_id, id`,
        args: [userId, n],
      },
      {
        sql: `SELECT report_id, last_seen_id
              FROM report_reads WHERE reader = 'user' AND report_id IN (${listedIds})`,
        args: [userId, n],
      },
    ],
    "read",
  );
  const rollup = rollUpThreads(messages.rows, markers.rows);
  return heads.rows.map((row) => {
    const r = toRow(row);
    const s = rollup.get(r.id);
    if (!s) return { ...r, message_count: 0, unread: 0 };
    return {
      ...r,
      message_count: s.count,
      last_author: s.lastAuthor,
      last_message_at: s.lastAt || r.created_at,
      unread: s.unread,
    };
  });
};

export interface ReportThreadData {
  id: number;
  user_id: number;
  status: ReportStatus;
  created_at: string;
  name: string | null;
  username: string | null;
  messages: ReportMessageRow[];
  /** how far `reader` has followed the conversation */
  last_seen_id: number;
}

/**
 * One conversation in a SINGLE round trip: the report head, every message
 * oldest first, the reporter's profile and the caller's read marker.
 * The database is ~250 ms away — the previous three sequential queries are
 * what made opening a thread feel slow.
 */
export const getReportThread = async (
  reportId: number,
  reader: MessageAuthor,
): Promise<ReportThreadData | null> => {
  const result = await turso.execute({
    sql: `SELECT r.id, r.user_id, r.status, r.created_at,
                 u.first_name AS name, u.username,
                 m.id AS message_id, m.author, m.body, m.created_at AS message_at,
                 (SELECT COALESCE(rd.last_seen_id, 0) FROM report_reads rd
                   WHERE rd.report_id = r.id AND rd.reader = ?) AS last_seen_id
          FROM reports r
          LEFT JOIN botusers u ON u.user_id = r.user_id
          JOIN report_messages m ON m.report_id = r.id
          WHERE r.id = ?
          ORDER BY m.id`,
    args: [reader, reportId],
  });

  if (result.rows.length === 0) {
    // a report with no messages yet: fall back to the bare head so a valid
    // thread never 404s (threads are seeded at creation, so this is rare)
    const report = await getReport(reportId);
    if (!report) return null;
    return {
      id: report.id,
      user_id: report.user_id,
      status: report.status,
      created_at: report.created_at,
      name: null,
      username: null,
      messages: [],
      last_seen_id: 0,
    };
  }

  const head = result.rows[0];
  return {
    id: Number(head.id),
    user_id: Number(head.user_id),
    status: String(head.status) as ReportStatus,
    created_at: String(head.created_at),
    name: head.name ? String(head.name) : null,
    username: head.username ? String(head.username) : null,
    messages: result.rows.map((row) => ({
      id: Number(row.message_id),
      report_id: reportId,
      author: String(row.author) as MessageAuthor,
      body: String(row.body),
      created_at: String(row.message_at),
    })),
    last_seen_id: Number(head.last_seen_id ?? 0),
  };
};

/**
 * Reporter follow-up in ONE write round trip: the message, the author's read
 * marker at their own new message, and the reopen flip. The marker subquery
 * sees the message inserted earlier in the same batch.
 */
export const appendUserThreadMessage = async (
  reportId: number,
  body: string,
  reopen: boolean,
): Promise<void> => {
  await turso.batch(
    [
      {
        sql: `INSERT INTO report_messages (report_id, author, body) VALUES (?, 'user', ?)`,
        args: [reportId, body],
      },
      {
        sql: `INSERT INTO report_reads (report_id, reader, last_seen_id, seen_at)
              VALUES (?, 'user',
                      (SELECT COALESCE(MAX(id), 0) FROM report_messages WHERE report_id = ?),
                      datetime('now'))
              ON CONFLICT(report_id, reader) DO UPDATE SET
                last_seen_id = MAX(report_reads.last_seen_id, excluded.last_seen_id),
                seen_at = excluded.seen_at`,
        args: [reportId, reportId],
      },
      // a follow-up means the admin owes an answer again
      ...(reopen
        ? [
            {
              sql: `UPDATE reports SET status = 'open' WHERE id = ?`,
              args: [reportId],
            },
          ]
        : []),
    ],
    "write",
  );
};

/**
 * Admin reply in ONE write round trip: the thread entry, the legacy reply
 * columns, and the admin's read marker — so the panel never flags the
 * admin's own message as "new" to them.
 */
export const recordAdminReply = async (
  reportId: number,
  reply: string,
): Promise<void> => {
  await turso.batch(
    [
      {
        sql: `INSERT INTO report_messages (report_id, author, body) VALUES (?, 'admin', ?)`,
        args: [reportId, reply],
      },
      {
        sql: `UPDATE reports
              SET admin_reply = ?, status = 'answered', replied_at = datetime('now')
              WHERE id = ?`,
        args: [reply, reportId],
      },
      {
        sql: `INSERT INTO report_reads (report_id, reader, last_seen_id, seen_at)
              VALUES (?, 'admin',
                      (SELECT COALESCE(MAX(id), 0) FROM report_messages WHERE report_id = ?),
                      datetime('now'))
              ON CONFLICT(report_id, reader) DO UPDATE SET
                last_seen_id = MAX(report_reads.last_seen_id, excluded.last_seen_id),
                seen_at = excluded.seen_at`,
        args: [reportId, reportId],
      },
    ],
    "write",
  );
};

export interface AdminReport extends ReportRow {
  name: string | null;
  username: string | null;
}

const toAdminRow = (row: Record<string, unknown>): AdminReport => ({
  ...toRow(row),
  name: row.name ? String(row.name) : null,
  username: row.username ? String(row.username) : null,
});

/** Admin listing: newest first, optional status filter, reporter names joined. */
export const listReports = async (
  status: ReportStatus | null,
  limit = 50,
): Promise<AdminReport[]> => {
  const n = Math.min(Math.max(limit, 1), 200);
  const where = (a: string) => (status ? `WHERE ${a}.status = ?` : "");
  const filter = status ? [status] : [];
  const listedIds = (a: string) =>
    `SELECT ${a}.id FROM reports ${a} ${where(a)} ORDER BY ${a}.id DESC LIMIT ?`;
  const [heads, messages, markers] = await turso.batch(
    [
      {
        sql: `SELECT r.id, r.user_id, r.message, r.status, r.admin_reply, r.replied_at, r.created_at,
                     u.first_name AS name, u.username
              FROM reports r
              LEFT JOIN botusers u ON u.user_id = r.user_id
              ${where("r")}
              ORDER BY r.id DESC LIMIT ?`,
        args: [...filter, n],
      },
      {
        sql: `SELECT m.report_id, m.id, m.author, m.created_at
              FROM report_messages m WHERE m.report_id IN (${listedIds("r2")})
              ORDER BY m.report_id, m.id`,
        args: [...filter, n],
      },
      {
        sql: `SELECT rd.report_id, rd.last_seen_id
              FROM report_reads rd
              WHERE rd.reader = 'admin' AND rd.report_id IN (${listedIds("r3")})`,
        args: [...filter, n],
      },
    ],
    "read",
  );
  const rollup = rollUpThreads(messages.rows, markers.rows);
  return heads.rows.map((row) => {
    const r = toAdminRow(row);
    const s = rollup.get(r.id);
    if (!s) return { ...r, message_count: 0, unread: 0 };
    return {
      ...r,
      message_count: s.count,
      last_author: s.lastAuthor,
      last_message_at: s.lastAt || r.created_at,
      unread: s.unread,
    };
  });
};

/** Record the admin's reply; flips status to answered. */
export const replyReport = async (
  id: number,
  reply: string,
): Promise<boolean> => {
  const result = await turso.execute({
    sql: `UPDATE reports
          SET admin_reply = ?, status = 'answered',
              replied_at = datetime('now')
          WHERE id = ?`,
    args: [reply, id],
  });
  return result.rowsAffected > 0;
};

/** Flip status (close/reopen). Returns whether a row changed. */
export const setReportStatus = async (
  id: number,
  status: ReportStatus,
): Promise<boolean> => {
  // closing or reopening never erases an existing reply
  const result = await turso.execute({
    sql: `UPDATE reports SET status = ? WHERE id = ?`,
    args: [status, id],
  });
  return result.rowsAffected > 0;
};
