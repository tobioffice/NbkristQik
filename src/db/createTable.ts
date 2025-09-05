import { turso } from "./db";

turso
  .execute(
    `
    CREATE TABLE IF NOT EXISTS fallbackResponses (
        id TEXT PRIMARY KEY CHECK(LENGTH(id) <= 50),
        content TEXT
    );
`
  )
  .then((res) => {
    console.log("Fallback Responses Table ensured", res);
  });
//
