import { turso } from "./db.js";

/**
 * The public half of a Telegram profile, for boards that have to name a
 * player who never chose a display name.
 */
export interface BotUserName {
  username: string | null;
  firstName: string | null;
}

const num = (value: unknown): number => Number(value ?? 0);
const nullableText = (value: unknown): string | null =>
  value == null || value === "" ? null : String(value);

/** The stored Telegram name and handle for each of these accounts. */
export const getBotUserNames = async (
  userIds: number[],
): Promise<Map<number, BotUserName>> => {
  const ids = [...new Set(userIds.map((id) => Math.trunc(Number(id))))].filter(
    (id) => Number.isFinite(id) && id > 0,
  );
  if (ids.length === 0) return new Map();

  const placeholders = ids.map(() => "?").join(", ");
  const result = await turso.execute({
    sql: `SELECT user_id, username, first_name FROM botusers
          WHERE user_id IN (${placeholders})`,
    args: ids,
  });
  return new Map(
    result.rows.map((row) => [
      num(row.user_id),
      {
        username: nullableText(row.username),
        firstName: nullableText(row.first_name),
      },
    ]),
  );
};
