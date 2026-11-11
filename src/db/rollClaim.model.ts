import { turso } from "./db.js";

/**
 * A roll proved by its college email. Exactly one account owns a roll; the
 * owner may hide its figures from everyone else with `blocked`.
 */
export interface RollClaim {
  roll_no: string;
  user_id: string;
  email: string;
  verified_at: string;
  /** 1 = the owner hid this roll from the public register. */
  blocked: number;
  updated_at: string;
}

const toClaim = (row: Record<string, unknown>): RollClaim => ({
  roll_no: String(row.roll_no),
  user_id: String(row.user_id),
  email: String(row.email),
  verified_at: String(row.verified_at),
  blocked: Number(row.blocked) === 1 ? 1 : 0,
  updated_at: String(row.updated_at),
});

export const getRollClaim = async (
  rollNo: string,
): Promise<RollClaim | null> => {
  const result = await turso.execute({
    sql: `SELECT roll_no, user_id, email, verified_at, blocked, updated_at
          FROM roll_claims WHERE UPPER(roll_no) = ?`,
    args: [rollNo.toUpperCase()],
  });
  return result.rows[0] ? toClaim(result.rows[0]) : null;
};

export const getClaimForUser = async (
  userId: string,
): Promise<RollClaim | null> => {
  const result = await turso.execute({
    sql: `SELECT roll_no, user_id, email, verified_at, blocked, updated_at
          FROM roll_claims WHERE user_id = ?
          ORDER BY verified_at DESC, rowid DESC
          LIMIT 1`,
    args: [String(userId)],
  });
  return result.rows[0] ? toClaim(result.rows[0]) : null;
};

/** Claim a roll for its verified owner. One claim per roll. */
export const upsertRollClaim = async (
  rollNo: string,
  userId: string,
  email: string,
): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO roll_claims (roll_no, user_id, email, verified_at, updated_at)
          VALUES (?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(roll_no) DO UPDATE SET
            user_id = excluded.user_id,
            email = excluded.email,
            verified_at = datetime('now'),
            updated_at = datetime('now')`,
    args: [rollNo.toUpperCase(), String(userId), email],
  });
};

/** Flip the owner's hide switch. Returns false when the user owns no claim. */
export const setClaimBlocked = async (
  userId: string,
  blocked: boolean,
): Promise<boolean> => {
  const result = await turso.execute({
    sql: `UPDATE roll_claims
          SET blocked = ?, updated_at = datetime('now')
          WHERE user_id = ?`,
    args: [blocked ? 1 : 0, String(userId)],
  });
  return Number(result.rowsAffected ?? 0) > 0;
};
