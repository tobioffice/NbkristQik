import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";

/**
 * The board's Telegram-name fallback: an unverified player with no chosen
 * display name is named by the profile the tracker already stores.
 */
const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

const { getBotUserNames } = await import("../../src/db/botUsers.model.js");

beforeAll(async () => {
  await client.batch(
    [
      `CREATE TABLE botusers (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        private_actions INTEGER NOT NULL DEFAULT 0,
        channel_actions INTEGER NOT NULL DEFAULT 0,
        group_actions INTEGER NOT NULL DEFAULT 0,
        total_actions INTEGER NOT NULL DEFAULT 0
      )`,
      `INSERT INTO botusers (user_id, username, first_name)
       VALUES (1, 'ravi_k', 'Ravi'), (2, NULL, 'Asha'), (3, NULL, NULL)`,
    ],
    "write",
  );
});

describe("getBotUserNames", () => {
  it("returns the stored handle and first name for the accounts it knows", async () => {
    expect(await getBotUserNames([1, 2, 3, 999])).toEqual(
      new Map([
        [1, { username: "ravi_k", firstName: "Ravi" }],
        [2, { username: null, firstName: "Asha" }],
        [3, { username: null, firstName: null }],
      ]),
    );
    expect(await getBotUserNames([])).toEqual(new Map());
  });
});
