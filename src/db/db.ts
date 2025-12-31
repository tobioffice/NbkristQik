import { createClient } from "@libsql/client";
import { config } from "dotenv";
config();

export const turso = createClient({
   url: process.env.TURSO_DATABASE_URL || "",
   authToken: process.env.TURSO_AUTH_TOKEN,
});
