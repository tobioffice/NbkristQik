import { turso } from "./db.js";

/**
 * One verification code, stored as a salted hash. The newest unconsumed,
 * unexpired row for a user and roll is the live one.
 */
export interface VerificationRow {
  id: number;
  user_id: string;
  roll_no: string;
  email: string;
  code_salt: string;
  code_hash: string;
  attempts: number;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

const toRow = (row: Record<string, unknown>): VerificationRow => ({
  id: Number(row.id),
  user_id: String(row.user_id),
  roll_no: String(row.roll_no),
  email: String(row.email),
  code_salt: String(row.code_salt),
  code_hash: String(row.code_hash),
  attempts: Number(row.attempts) || 0,
  created_at: String(row.created_at),
  expires_at: String(row.expires_at),
  consumed_at: row.consumed_at ? String(row.consumed_at) : null,
});

/** Codes sent to this account in the last `seconds`, for the resend guard. */
export const countRecentVerifications = async (
  userId: string,
  seconds: number,
): Promise<number> => {
  const result = await turso.execute({
    sql: `SELECT COUNT(*) AS n FROM email_verifications
          WHERE user_id = ? AND created_at > datetime('now', ?)`,
    args: [String(userId), `-${Math.max(1, Math.floor(seconds))} seconds`],
  });
  return Number(result.rows[0]?.n || 0);
};

/** Retire any live code for this user and roll before sending a new one. */
export const supersedeVerifications = async (
  userId: string,
  rollNo: string,
): Promise<void> => {
  await turso.execute({
    sql: `UPDATE email_verifications SET consumed_at = datetime('now')
          WHERE user_id = ? AND UPPER(roll_no) = ? AND consumed_at IS NULL`,
    args: [String(userId), rollNo.toUpperCase()],
  });
};

export const createVerification = async (input: {
  userId: string;
  rollNo: string;
  email: string;
  salt: string;
  hash: string;
  ttlSeconds: number;
}): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO email_verifications
            (user_id, roll_no, email, code_salt, code_hash, expires_at)
          VALUES (?, ?, ?, ?, ?, datetime('now', ?))`,
    args: [
      String(input.userId),
      input.rollNo.toUpperCase(),
      input.email,
      input.salt,
      input.hash,
      `+${Math.max(60, Math.floor(input.ttlSeconds))} seconds`,
    ],
  });
};

export const findLiveVerification = async (
  userId: string,
  rollNo: string,
): Promise<VerificationRow | null> => {
  const result = await turso.execute({
    sql: `SELECT id, user_id, roll_no, email, code_salt, code_hash, attempts,
                 created_at, expires_at, consumed_at
          FROM email_verifications
          WHERE user_id = ? AND UPPER(roll_no) = ?
            AND consumed_at IS NULL
            AND expires_at > datetime('now')
          ORDER BY id DESC LIMIT 1`,
    args: [String(userId), rollNo.toUpperCase()],
  });
  return result.rows[0] ? toRow(result.rows[0]) : null;
};

export const bumpVerificationAttempts = async (id: number): Promise<void> => {
  await turso.execute({
    sql: `UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?`,
    args: [id],
  });
};

export const consumeVerification = async (id: number): Promise<void> => {
  await turso.execute({
    sql: `UPDATE email_verifications SET consumed_at = datetime('now') WHERE id = ?`,
    args: [id],
  });
};
