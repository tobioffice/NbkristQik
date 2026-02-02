import { logger } from "../utils/logger.js";
import { turso } from "./db.js";

turso
  .execute(
    `
    CREATE TABLE IF NOT EXISTS fallbackResponses (
        id TEXT PRIMARY KEY CHECK(LENGTH(id) <= 50),
        content TEXT
    );
`,
  )
  .then((res) => {
    logger.info("Fallback Responses Table ensured");
  });
