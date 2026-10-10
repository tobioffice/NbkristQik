import { turso } from "./db.js";

/**
 * Issue reports. Every report gets a stable, human-friendly issue id
 * (QIK-0007) the reporter and the admin can reference in chat; the admin
 * replies flow back to the reporter's Telegram chat.
 *
 * Statuses: open (fresh, no reply yet) -> answered (admin replied) ->
 * resolved (admin closed it).
 */

export type ReportStatus = "open" | "answered" | "resolved";

export interface ReportRow {
  id: number;
  user_id: number;
  message: string;
  status: ReportStatus;
  admin_reply: string | null;
  replied_at: string | null;
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
});

export const createReport = async (
  userId: number,
  message: string,
): Promise<number> => {
  const result = await turso.execute({
    sql: `INSERT INTO reports (user_id, message) VALUES (?, ?)`,
    args: [userId, message],
  });
  return Number(result.lastInsertRowid);
};

export const getReport = async (id: number): Promise<ReportRow | null> => {
  const result = await turso.execute({
    sql: `SELECT id, user_id, message, status, admin_reply, replied_at, created_at
          FROM reports WHERE id = ?`,
    args: [id],
  });
  return result.rows[0] ? toRow(result.rows[0]) : null;
};

export const listUserReports = async (
  userId: number,
  limit = 20,
): Promise<ReportRow[]> => {
  const result = await turso.execute({
    sql: `SELECT id, user_id, message, status, admin_reply, replied_at, created_at
          FROM reports WHERE user_id = ?
          ORDER BY id DESC LIMIT ?`,
    args: [userId, Math.min(Math.max(limit, 1), 50)],
  });
  return result.rows.map(toRow);
};

export interface AdminReport extends ReportRow {
  name: string | null;
  username: string | null;
}

/** Admin listing: newest first, optional status filter, reporter names joined. */
export const listReports = async (
  status: ReportStatus | null,
  limit = 50,
): Promise<AdminReport[]> => {
  const where = status ? `WHERE r.status = ?` : "";
  const args = status
    ? [status, Math.min(Math.max(limit, 1), 200)]
    : [Math.min(Math.max(limit, 1), 200)];
  const result = await turso.execute({
    sql: `SELECT r.id, r.user_id, r.message, r.status, r.admin_reply, r.replied_at, r.created_at,
                 u.first_name AS name, u.username
          FROM reports r
          LEFT JOIN botusers u ON u.user_id = r.user_id
          ${where}
          ORDER BY r.id DESC LIMIT ?`,
    args,
  });
  return result.rows.map((r) => ({
    ...toRow(r),
    name: r.name ? String(r.name) : null,
    username: r.username ? String(r.username) : null,
  }));
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
