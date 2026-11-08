import { turso } from "../db.js";

export type ResponseType = "att" | "mid";

/** fallbackResponses primary key: "<year>-<branch>-<section>-<type>" */
export const buildResponseId = (
  year: string,
  branch: string,
  section: string,
  type: ResponseType,
): string => `${year}-${branch}-${section}-${type}`;

/**
 * The saved copy of a section report and when it was saved (UTC, SQLite
 * datetime format). `updatedAt` is null for rows written before schema v2 —
 * the caller can still show the copy, just without an age.
 */
export interface FallbackResponse {
  content: string;
  updatedAt: string | null;
}

export const storeResponse = (id: string, content: string) => {
  return turso.execute({
    sql: `INSERT OR REPLACE INTO fallbackResponses (id, content, updated_at)
          VALUES (?, ?, datetime('now'))`,
    args: [id, content],
  });
};

/** The record getter: content plus the age the bot can print. */
export const getResponseRecord = async (
  id: string,
): Promise<FallbackResponse | null> => {
  const result = await turso.execute({
    sql: `SELECT content, updated_at FROM fallbackResponses WHERE id = ?`,
    args: [id],
  });

  if (result.rows.length === 0) return null;

  return {
    content: result.rows[0].content as string,
    updatedAt:
      result.rows[0].updated_at == null
        ? null
        : String(result.rows[0].updated_at),
  };
};

/**
 * String getter kept for existing importers. New callers that need the age
 * should use `getResponseRecord`.
 */
export const getResponse = async (id: string): Promise<string> => {
  const record = await getResponseRecord(id);
  if (record) return record.content;
  throw new Error("No fallback response found.");
};
