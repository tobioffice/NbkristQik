import { turso } from "../db.js";

export type ResponseType = "att" | "mid";

/** fallbackResponses primary key: "<year>-<branch>-<section>-<type>" */
export const buildResponseId = (
  year: string,
  branch: string,
  section: string,
  type: ResponseType,
): string => `${year}-${branch}-${section}-${type}`;

export const storeResponse = (id: string, content: string) => {
  return turso.execute({
    sql: `INSERT OR REPLACE INTO fallbackResponses (id, content) VALUES (?, ?)`,
    args: [id, content],
  });
};

export const getResponse = async (id: string): Promise<string> => {
  const result = await turso.execute({
    sql: `SELECT content FROM fallbackResponses WHERE id = ?`,
    args: [id],
  });

  if (result.rows.length > 0) {
    return result.rows[0].content as string;
  } else {
    throw new Error("No fallback response found.");
  }
};
