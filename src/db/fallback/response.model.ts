import { turso } from "../db.js";

export const storeResponse = (
  year: string,
  branch: string,
  section: string,
  type: "att" | "mid",
  content: string,
) => {
  try {
    const id = `${year}-${branch}-${section}-${type}`;
    return turso.execute({
      sql: `INSERT OR REPLACE INTO fallbackResponses (id, content) VALUES (?, ?)`,
      args: [id, content],
    });
  } catch {
    return Promise.resolve();
  }
};

export const getResponse = async (
  year: string,
  branch: string,
  section: string,
  type: "att" | "mid",
): Promise<string | null> => {
  try {
    const id = `${year}-${branch}-${section}-${type}`;
    console.log("Fetching response for ID:", id); // Debug log
    const result = await turso.execute({
      sql: `SELECT content FROM fallbackResponses WHERE id = ?`,
      args: [id],
    });

    if (result.rows.length > 0) {
      return result.rows[0].content as string;
    } else {
      return null;
    }
  } catch (error) {
    console.log("Error fetching response:", error); // Debug log
    return null;
  }
};
