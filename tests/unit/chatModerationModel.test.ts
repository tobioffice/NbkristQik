import { beforeAll, describe, expect, it } from "vitest";
import { turso } from "../../src/db/db.js";
import { initDatabase } from "../../src/db/init.js";
import {
  addBlockedKeyword,
  clearChatMessages,
  getModeratedUser,
  listBlockedKeywords,
  listModeratedUsers,
  listModerationActions,
  logChatMessage,
  logModerationAction,
  pruneChatMessages,
  pruneExpiredModeratedUsers,
  readChatMessageIds,
  readModerationSettingRows,
  readModerationStats,
  removeBlockedKeyword,
  removeChatMessage,
  removeModeratedUser,
  upsertModeratedUser,
  writeModerationSettingRows,
} from "../../src/db/chatModeration.model.js";

beforeAll(async () => {
  await initDatabase();
});

describe("chat moderation tables", () => {
  it("seeds the default word list exactly once", async () => {
    const words = await listBlockedKeywords();
    expect(words.length).toBeGreaterThan(50);
    expect(words.map((word) => word.phrase)).toContain("sex");

    // the seed marker means a restart does not re-add a removed default
    const seeded = await initDatabase();
    expect(seeded).toBeUndefined();
    expect((await listBlockedKeywords()).length).toBe(words.length);
  });

  it("adds and removes a custom word, ignoring a duplicate", async () => {
    const added = await addBlockedKeyword("custom phrase");
    expect(added?.phrase).toBe("custom phrase");

    expect(await addBlockedKeyword("custom phrase")).toBeNull();
    expect(await addBlockedKeyword("CUSTOM PHRASE")).toBeNull();

    expect(await removeBlockedKeyword(added?.id ?? 0)).toBe(true);
    expect(await removeBlockedKeyword(added?.id ?? 0)).toBe(false);
  });

  it("stores settings as rows the service can merge over defaults", async () => {
    const rows = await readModerationSettingRows();
    expect(rows.get("enabled")).toBe("1");

    await writeModerationSettingRows({ auto_mute: "0", mute_seconds: "60" });
    const updated = await readModerationSettingRows();
    expect(updated.get("auto_mute")).toBe("0");
    expect(updated.get("mute_seconds")).toBe("60");
  });

  it("remembers message ids only as long as Telegram can delete them", async () => {
    await logChatMessage(-100900, 7, 101);
    await logChatMessage(-100900, 7, 102);
    await logChatMessage(-100900, 8, 103);

    expect(await readChatMessageIds(-100900, 7)).toEqual([102, 101]);

    await removeChatMessage(-100900, 102);
    expect(await readChatMessageIds(-100900, 7)).toEqual([101]);

    // a message old enough to be outside the delete window is pruned
    await turso.execute({
      sql: `UPDATE chat_messages SET created_at = datetime('now', '-3 days')
            WHERE message_id = 101`,
    });
    expect(await pruneChatMessages(48)).toBe(1);

    await clearChatMessages(-100900, 8);
    expect(await readChatMessageIds(-100900, 8)).toEqual([]);
  });

  it("stores a mute with its lift time, then a ban over it", async () => {
    await upsertModeratedUser({
      chatId: -100901,
      userId: 10,
      state: "muted",
      untilSeconds: 900,
      reason: "Blocked word: sex",
      actor: "auto",
      username: "student",
      firstName: "Student",
    });

    const muted = await getModeratedUser(-100901, 10);
    expect(muted).toMatchObject({
      state: "muted",
      reason: "Blocked word: sex",
      actor: "auto",
      username: "student",
      firstName: "Student",
    });
    expect(muted?.untilDate).toBeTruthy();

    await upsertModeratedUser({
      chatId: -100901,
      userId: 10,
      state: "banned",
      reason: "spam",
      actor: "admin",
    });
    const banned = await getModeratedUser(-100901, 10);
    expect(banned).toMatchObject({ state: "banned", untilDate: null });

    expect(await listModeratedUsers()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 10, state: "banned" }),
      ]),
    );

    expect(await removeModeratedUser(-100901, 10)).toBe(true);
    expect(await getModeratedUser(-100901, 10)).toBeNull();
  });

  it("lets an expired mute go without an explicit unmute", async () => {
    await upsertModeratedUser({
      chatId: -100902,
      userId: 11,
      state: "muted",
      untilSeconds: 60,
      actor: "panel",
    });
    await turso.execute({
      sql: `UPDATE chat_moderation_users SET until_date = datetime('now', '-1 minute')
            WHERE chat_id = -100902 AND user_id = 11`,
    });

    expect(await getModeratedUser(-100902, 11)).toBeNull();
    expect(await pruneExpiredModeratedUsers()).toBeGreaterThanOrEqual(1);
  });

  it("writes the audit trail and summarises it for the panel", async () => {
    await logModerationAction({
      chatId: -100903,
      userId: 12,
      firstName: "Ravi",
      action: "ban",
      reason: "spam",
      actor: "admin",
      deletedCount: 4,
    });
    await logModerationAction({
      chatId: -100903,
      userId: 13,
      action: "auto_mute",
      reason: "Blocked word: sex",
      actor: "auto",
    });

    const actions = await listModerationActions(10);
    expect(actions[0]).toMatchObject({
      userId: 13,
      action: "auto_mute",
      deletedCount: 0,
    });
    expect(actions[1]).toMatchObject({
      userId: 12,
      action: "ban",
      deletedCount: 4,
    });

    const stats = await readModerationStats();
    expect(stats.actionsToday).toBeGreaterThanOrEqual(2);
    expect(stats.deletedToday).toBeGreaterThanOrEqual(4);
  });
});
