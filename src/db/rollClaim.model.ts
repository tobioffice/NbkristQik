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
  /** 1 = at least one privacy switch is on (mirror for older readers). */
  blocked: number;
  /** 1 = the row is hidden from the public leaderboard. */
  hide_leaderboard: number;
  /** 1 = other accounts may not fetch this roll's data. */
  block_lookups: number;
  /** 1 = other accounts may not register this roll. */
  block_registration: number;
  updated_at: string;
}

export interface RollClaimOptions {
  hideLeaderboard: boolean;
  blockLookups: boolean;
  blockRegistration: boolean;
}

const toClaim = (row: Record<string, unknown>): RollClaim => ({
  roll_no: String(row.roll_no),
  user_id: String(row.user_id),
  email: String(row.email),
  verified_at: String(row.verified_at),
  blocked: Number(row.blocked) === 1 ? 1 : 0,
  hide_leaderboard: Number(row.hide_leaderboard) === 1 ? 1 : 0,
  block_lookups: Number(row.block_lookups) === 1 ? 1 : 0,
  block_registration: Number(row.block_registration) === 1 ? 1 : 0,
  updated_at: String(row.updated_at),
});

export const getRollClaim = async (
  rollNo: string,
): Promise<RollClaim | null> => {
  const result = await turso.execute({
    sql: `SELECT roll_no, user_id, email, verified_at, blocked,
                 hide_leaderboard, block_lookups, block_registration, updated_at
          FROM roll_claims WHERE UPPER(roll_no) = ?`,
    args: [rollNo.toUpperCase()],
  });
  return result.rows[0] ? toClaim(result.rows[0]) : null;
};

export const getClaimForUser = async (
  userId: string,
): Promise<RollClaim | null> => {
  const result = await turso.execute({
    sql: `SELECT roll_no, user_id, email, verified_at, blocked,
                 hide_leaderboard, block_lookups, block_registration, updated_at
          FROM roll_claims WHERE user_id = ?
          ORDER BY verified_at DESC, rowid DESC
          LIMIT 1`,
    args: [String(userId)],
  });
  return result.rows[0] ? toClaim(result.rows[0]) : null;
};

/** Claim a roll for its verified owner. One claim per roll; one account may
 * hold claims on more than one roll. */
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
            blocked = 0,
            hide_leaderboard = 0,
            block_lookups = 0,
            block_registration = 0,
            updated_at = datetime('now')`,
    args: [rollNo.toUpperCase(), String(userId), email],
  });
};

/**
 * Set the owner's three privacy switches. Returns false when the user owns no
 * claim. `blocked` is kept as the "any switch is on" mirror.
 */
export const setClaimOptions = async (
  userId: string,
  options: RollClaimOptions,
): Promise<boolean> => {
  const claim = await getClaimForUser(userId);
  if (!claim) return false;

  const hide = options.hideLeaderboard ? 1 : 0;
  const lookups = options.blockLookups ? 1 : 0;
  const registration = options.blockRegistration ? 1 : 0;
  const any = hide || lookups || registration;
  const result = await turso.execute({
    sql: `UPDATE roll_claims
          SET hide_leaderboard = ?, block_lookups = ?, block_registration = ?,
              blocked = ?, updated_at = datetime('now')
          WHERE roll_no = ? AND user_id = ?`,
    args: [hide, lookups, registration, any, claim.roll_no, String(userId)],
  });
  return Number(result.rowsAffected ?? 0) > 0;
};
