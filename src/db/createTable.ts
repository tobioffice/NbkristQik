import { turso } from "./db";

turso
  .execute(
    `
    CREATE TABLE IF NOT EXISTS fallbackResponces (
        id TEXT PRIMARY KEY CHECK(LENGTH(id) <= 50),
        content TEXT
    );
`
  )
  .then((res) => {
    console.log("Fallback Responces Table ensured", res);
  });
