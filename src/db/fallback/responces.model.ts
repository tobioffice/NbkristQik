import { turso } from "../db";

export const storeResponce = (
  year: string,
  branch: string,
  section: string,
  type: "att" | "mid",
  content: string
) => {
  const id = `${year}-${branch}-${section}-${type}`;
  return turso.execute({
    sql: `INSERT OR REPLACE INTO fallbackResponces (id, content) VALUES (?, ?)`,
    args: [id, content],
  });
};

export const getResponce = async (
  year: string,
  branch: string,
  section: string,
  type: "att" | "mid"
): Promise<string | null> => {
  const id = `${year}-${branch}-${section}-${type}`;
  const result = await turso.execute({
    sql: `SELECT content FROM fallbackResponces WHERE id = ?`,
    args: [id],
  });

  if (result.rows.length > 0) {
    return result.rows[0].content as string;
  } else {
    return null;
  }
};
