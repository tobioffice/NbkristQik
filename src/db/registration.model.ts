import { turso } from "./db.js";

/**
 * Optional user registration: a Telegram user pins their default roll number
 * (plus an optional display name) so /attendance, /midmarks, and /bunk work
 * without typing the roll. Editing is allowed anytime; there is no delete —
 * the roll is re-usable and public-record data, and re-registering overwrites.
 *
 * Kept separate from tgusers: tgusers is auto-upserted on every roll lookup
 * (including friend lookups) and would silently overwrite an explicit
 * registration. Registration is deliberate user state that must not drift.
 *
 * One roll belongs to one Telegram account. Two accounts claiming the same
 * roll would make the leaderboard name and the admin trace ambiguous, so the
 * app-level guard below rejects the second claim. A unique index added by the
 * schema migration backs this up for concurrent writers.
 */

export interface Registration {
  userId: string;
  roll_no: string;
  display_name: string | null;
  registered_at: string;
  updated_at: string;
}

const toRegistration = (row: Record<string, unknown>): Registration => ({
  userId: String(row.userId),
  roll_no: String(row.roll_no),
  display_name: row.display_name ? String(row.display_name) : null,
  registered_at: String(row.registered_at),
  updated_at: String(row.updated_at),
});

/** Insert or update. Keeps registered_at, refreshes updated_at. */
export const upsertRegistration = async (
  userId: string,
  rollNo: string,
  displayName: string | null,
): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO registrations (userId, roll_no, display_name, registered_at, updated_at)
          VALUES (?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(userId) DO UPDATE SET
            roll_no = excluded.roll_no,
            display_name = excluded.display_name,
            updated_at = datetime('now')`,
    args: [userId, rollNo.toUpperCase(), displayName],
  });
};

export const getRegistration = async (
  userId: string,
): Promise<Registration | null> => {
  const result = await turso.execute({
    sql: `SELECT userId, roll_no, display_name, registered_at, updated_at
          FROM registrations WHERE userId = ?`,
    args: [userId],
  });
  return result.rows[0] ? toRegistration(result.rows[0]) : null;
};

/**
 * The newest registration for a roll, if any.
 *
 * Several accounts may hold the same roll now, so this answers with the most
 * recently updated claim. rowid breaks a same-second tie in favour of the
 * later insert, which keeps the answer stable instead of arbitrary.
 */
export const getRegistrationByRoll = async (
  rollNo: string,
): Promise<Registration | null> => {
  const result = await turso.execute({
    sql: `SELECT userId, roll_no, display_name, registered_at, updated_at
          FROM registrations
          WHERE UPPER(roll_no) = ?
          ORDER BY updated_at DESC, rowid DESC
          LIMIT 1`,
    args: [rollNo.toUpperCase()],
  });
  return result.rows[0] ? toRegistration(result.rows[0]) : null;
};
