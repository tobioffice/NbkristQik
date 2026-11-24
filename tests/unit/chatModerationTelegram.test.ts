import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  botInfo: { id: 999 } as { id: number } | undefined,
  api: {
    getMe: vi.fn(),
    getChatMember: vi.fn(),
    getChat: vi.fn(),
    getChatMemberCount: vi.fn(),
    deleteMessage: vi.fn(),
    deleteMessages: vi.fn(),
  },
}));

vi.mock("../../src/bot/bot.js", () => ({
  bot: { api: h.api, botInfo: h.botInfo },
}));

const {
  botUserId,
  deleteMessageQuietly,
  deleteMessagesQuietly,
  friendlyTelegramError,
  getChatSummary,
  invalidateChatAdmin,
  invalidateChatSummary,
  isChatAdmin,
  telegramErrorText,
} = await import("../../src/services/moderation/telegram.js");

beforeEach(() => {
  vi.clearAllMocks();
  h.api.getMe.mockResolvedValue({ id: 777 });
  h.api.getChat.mockResolvedValue({
    id: -100123,
    title: "Test group",
    type: "supergroup",
    username: "test_chat",
  });
  h.api.getChatMemberCount.mockResolvedValue(42);
  h.api.getChatMember.mockResolvedValue({
    status: "administrator",
    can_delete_messages: true,
    can_restrict_members: true,
  });
  h.api.deleteMessage.mockResolvedValue(true);
  h.api.deleteMessages.mockResolvedValue(true);
  invalidateChatSummary(-100123);
});

describe("moderation Telegram helpers", () => {
  it("uses the bot identity Telegram already fetched", async () => {
    await expect(botUserId()).resolves.toBe(999);
    expect(h.api.getMe).not.toHaveBeenCalled();
  });

  it("reads an admin, a regular member and a failed lookup", async () => {
    const chatId = -100200;
    h.api.getChatMember.mockResolvedValueOnce({ status: "creator" });
    await expect(isChatAdmin(chatId, 1)).resolves.toBe(true);

    h.api.getChatMember.mockResolvedValueOnce({ status: "member" });
    await expect(isChatAdmin(chatId, 2)).resolves.toBe(false);

    h.api.getChatMember.mockRejectedValueOnce(new Error("network down"));
    await expect(isChatAdmin(chatId, 3)).resolves.toBeNull();

    // the answers are cached per member, so a burst costs one lookup
    const calls = h.api.getChatMember.mock.calls.length;
    await expect(isChatAdmin(chatId, 1)).resolves.toBe(true);
    expect(h.api.getChatMember.mock.calls.length).toBe(calls);

    invalidateChatAdmin(chatId, 1);
    h.api.getChatMember.mockResolvedValueOnce({ status: "administrator" });
    await expect(isChatAdmin(chatId, 1)).resolves.toBe(true);
  });

  it("summarises a chat, its member count and the bot's rights", async () => {
    const summary = await getChatSummary(-100123);

    expect(summary.title).toBe("Test group");
    expect(summary.username).toBe("test_chat");
    expect(summary.memberCount).toBe(42);
    expect(summary.bot).toEqual({
      isAdmin: true,
      canDelete: true,
      canRestrict: true,
      error: null,
    });

    // cached for a minute, so opening the panel again is free
    await getChatSummary(-100123);
    expect(h.api.getChat).toHaveBeenCalledTimes(1);
  });

  it("reports a chat where the bot is not an admin", async () => {
    h.api.getChatMember.mockResolvedValue({ status: "member" });
    const summary = await getChatSummary(-100124);
    expect(summary.bot.isAdmin).toBe(false);
    expect(summary.bot.error).toMatch(/not an admin/i);
  });

  it("reports missing delete or restrict rights", async () => {
    h.api.getChatMember.mockResolvedValue({
      status: "administrator",
      can_delete_messages: false,
      can_restrict_members: true,
    });
    const summary = await getChatSummary(-100125);
    expect(summary.bot).toMatchObject({
      isAdmin: true,
      canDelete: false,
      canRestrict: true,
    });
  });

  it("deletes a message quietly and reports whether it went", async () => {
    await expect(deleteMessageQuietly(-100123, 5)).resolves.toBe(true);
    h.api.deleteMessage.mockRejectedValueOnce(new Error("message not found"));
    await expect(deleteMessageQuietly(-100123, 5)).resolves.toBe(false);
  });

  it("deletes in bulk and retries one by one when a batch is refused", async () => {
    await expect(deleteMessagesQuietly(-100123, [1, 2, 3])).resolves.toBe(3);
    expect(h.api.deleteMessages).toHaveBeenCalledWith({
      chat_id: -100123,
      message_ids: [1, 2, 3],
    });

    h.api.deleteMessages.mockRejectedValueOnce(new Error("too old"));
    h.api.deleteMessage
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("gone"))
      .mockResolvedValueOnce(true);

    await expect(deleteMessagesQuietly(-100123, [1, 2, 3])).resolves.toBe(2);

    // an empty or invalid list is a no-op
    await expect(deleteMessagesQuietly(-100123, [])).resolves.toBe(0);
    h.api.deleteMessages.mockClear();
    await expect(
      deleteMessagesQuietly(-100123, [0, -1, 1.5, 4, 4]),
    ).resolves.toBe(1);
    expect(h.api.deleteMessages).toHaveBeenCalledWith({
      chat_id: -100123,
      message_ids: [4],
    });
  });

  it("turns Telegram's raw error into a sentence the admin can act on", () => {
    expect(
      friendlyTelegramError(
        new Error(
          "Bad Request: not enough rights to restrict/unrestrict chat member",
        ),
      ),
    ).toMatch(/admin with delete and restrict/);

    expect(
      friendlyTelegramError(new Error("Bad Request: user is an administrator")),
    ).toMatch(/group admin/);

    expect(
      friendlyTelegramError(new Error("Bad Request: participant not found")),
    ).toMatch(/isn't in this group/);

    expect(
      friendlyTelegramError(new Error("Bad Request: chat not found")),
    ).toMatch(/can't reach that group/);

    expect(
      friendlyTelegramError(new Error("Bad Request: something else broke")),
    ).toBe("something else broke");

    expect(telegramErrorText("plain string")).toBe("plain string");
  });
});
