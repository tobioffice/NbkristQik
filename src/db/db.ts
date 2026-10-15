import { createClient } from "@libsql/client";
import { config } from "dotenv";
config();

/**
 * Database connection.
 *
 * Set LOCAL_DB_URL (e.g. "file:/home/ubuntu/nbkristqik/data/qik.db") to run
 * the database as an embedded libSQL/SQLite file on the same box as the bot:
 * no network hop, no read quota, microsecond queries. Leave it unset to use
 * Turso Cloud as before.
 */
const localUrl = process.env.LOCAL_DB_URL?.trim();

export const turso = localUrl
  ? createClient({ url: localUrl })
  : createClient({
      url: process.env.TURSO_DATABASE_URL || "",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
