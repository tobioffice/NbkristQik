import { describe, it, expect } from "vitest";
import {
  configureDatabase,
  isEmbeddedDatabase,
  turso,
} from "../../src/db/db.js";

const pragmaValue = async (sql: string): Promise<unknown> => {
  const result = await turso.execute(sql);
  return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
};

describe("configureDatabase", () => {
  it("targets the embedded database in tests", () => {
    expect(isEmbeddedDatabase).toBe(true);
  });

  it("sets busy_timeout and WAL-or-memory durability on the client", async () => {
    await configureDatabase();

    expect(Number(await pragmaValue("PRAGMA busy_timeout"))).toBeGreaterThan(0);

    // file::memory: can only report "memory"; a real file reports "wal"
    expect(
      String(await pragmaValue("PRAGMA journal_mode")).toLowerCase(),
    ).toMatch(/^(wal|memory)$/);

    // synchronous = NORMAL (1) — durable through an app crash with WAL
    expect(Number(await pragmaValue("PRAGMA synchronous"))).toBe(1);
    expect(Number(await pragmaValue("PRAGMA foreign_keys"))).toBe(1);
  });

  it("is safe to run repeatedly", async () => {
    await configureDatabase();
    await configureDatabase();
    expect(Number(await pragmaValue("PRAGMA busy_timeout"))).toBe(5000);
  });
});
