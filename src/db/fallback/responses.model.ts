import { turso } from "../db.js";

export const storeResponse = (
  year: string,
  branch: string,
  section: string,
  type: "att" | "mid",
  content: string,
) => {
  const id = `${year}-${branch}-${section}-${type}`;
  return turso.execute({
    sql: `INSERT OR REPLACE INTO fallbackResponses (id, content) VALUES (?, ?)`,
    args: [id, content],
  });
};

export const getResponse = async (
  year: string,
  branch: string,
  section: string,
  type: "att" | "mid",
): Promise<string | null> => {
  const id = `${year}-${branch}-${section}-${type}`;
  const result = await turso.execute({
    sql: `SELECT content FROM fallbackResponses WHERE id = ?`,
    args: [id],
  });

  if (result.rows.length > 0) {
    return result.rows[0].content as string;
  } else {
    return null;
  }
};
