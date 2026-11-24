import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  list: vi.fn<
    () => Promise<{ id: number; phrase: string; createdAt: string }[]>
  >(),
  add: vi.fn<
    (
      phrase: string,
    ) => Promise<{ id: number; phrase: string; createdAt: string } | null>
  >(),
  remove: vi.fn<(id: number) => Promise<boolean>>(),
}));

vi.mock("../../src/db/chatModeration.model.js", () => ({
  listBlockedKeywords: h.list,
  addBlockedKeyword: h.add,
  removeBlockedKeyword: h.remove,
}));

const {
  addKeyword,
  getActiveKeywords,
  invalidateKeywordCache,
  KeywordError,
  matchBlockedWords,
  removeKeyword,
  sanitizeKeyword,
} = await import("../../src/services/moderation/keywords.js");

const row = (id: number, phrase: string) => ({
  id,
  phrase,
  createdAt: "2026-01-01 00:00:00",
});

beforeEach(() => {
  vi.clearAllMocks();
  invalidateKeywordCache();
  h.list.mockResolvedValue([row(1, "sex"), row(2, "fuck")]);
  h.add.mockResolvedValue(null);
  h.remove.mockResolvedValue(true);
});

describe("blocked words", () => {
  it("trims and rejects a phrase that cannot be stored", () => {
    expect(sanitizeKeyword("  hello   world  ")).toBe("hello world");
    expect(sanitizeKeyword("a")).toBeNull();
    expect(sanitizeKeyword("x".repeat(61))).toBeNull();
    expect(sanitizeKeyword("line\nbreak")).toBe("line break");
    expect(sanitizeKeyword(42)).toBeNull();
  });

  it("matches a message against the cached list", async () => {
    await expect(matchBlockedWords("this is S3X")).resolves.toEqual(["sex"]);
    await expect(matchBlockedWords("good morning")).resolves.toEqual([]);
    await expect(matchBlockedWords("")).resolves.toEqual([]);

    // the compiled list is cached, so one read served all three checks
    expect(h.list).toHaveBeenCalledTimes(1);
  });

  it("adds a phrase, clears the cache and reports a duplicate", async () => {
    h.add.mockResolvedValue(row(3, "nudes"));
    h.list.mockResolvedValue([row(1, "sex"), row(2, "fuck"), row(3, "nudes")]);

    const added = await addKeyword("  nudes ");
    expect(added.created).toBe(true);
    expect(h.add).toHaveBeenCalledWith("nudes");
    expect(added.active.rows).toHaveLength(3);

    h.add.mockResolvedValue(null);
    const duplicate = await addKeyword("sex");
    expect(duplicate.created).toBe(false);
  });

  it("throws a readable error for a phrase that is too short", async () => {
    await expect(addKeyword("x")).rejects.toBeInstanceOf(KeywordError);
    expect(h.add).not.toHaveBeenCalled();
  });

  it("removes a phrase and answers with the new list", async () => {
    h.list.mockResolvedValue([]);
    const removed = await removeKeyword(9);

    expect(removed.removed).toBe(true);
    expect(removed.active.rows).toEqual([]);
    expect(h.remove).toHaveBeenCalledWith(9);
  });

  it("surfaces an empty list to the bot without a match", async () => {
    h.list.mockResolvedValue([]);
    const active = await getActiveKeywords(true);
    expect(active.rows).toEqual([]);
    await expect(matchBlockedWords("sex")).resolves.toEqual([]);
  });
});
