import { beforeEach, describe, expect, it, vi } from "vitest";

type RestrictParams = {
  chat_id: number;
  user_id: number;
  until_date?: number;
  use_independent_chat_permissions?: boolean;
  permissions?: { can_send_messages?: boolean };
};

const h = vi.hoisted(() => ({
  readChatMessageIds: vi.fn<() => Promise<number[]>>(),
  clearChatMessages: vi.fn<() => Promise<void>>(),
  upsertModeratedUser: vi.fn<(user: unknown) => Promise<void>>(),
  removeModeratedUser:
    vi.fn<(chatId: number, userId: number) => Promise<boolean>>(),
  logModerationAction: vi.fn<(action: unknown) => Promise<void>>(),
  banChatMember: vi.fn<(params: unknown) => Promise<boolean>>(),
  unbanChatMember: vi.fn<(params: unknown) => Promise<boolean>>(),
  restrictChatMember: vi.fn<(params: RestrictParams) => Promise<boolean>>(),
  deleteMessage: vi.fn<(params: unknown) => Promise<boolean>>(),
  deleteMessages: vi.fn<(params: unknown) => Promise<boolean>>(),
}));

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    api: {
      banChatMember: h.banChatMember,
      unbanChatMember: h.unbanChatMember,
      restrictChatMember: h.restrictChatMember,
      deleteMessage: h.deleteMessage,
      deleteMessages: h.deleteMessages,
    },
  },
}));

vi.mock("../../src/db/chatModeration.model.js", () => ({
  readChatMessageIds: h.readChatMessageIds,
  clearChatMessages: h.clearChatMessages,
  upsertModeratedUser: h.upsertModeratedUser,
  removeModeratedUser: h.removeModeratedUser,
  logModerationAction: h.logModerationAction,
}));

vi.mock("../../src/services/moderation/settings.js", () => ({
  clampMuteSeconds: (value: unknown) => {
    const seconds = Math.trunc(Number(value));
    return Number.isFinite(seconds)
      ? Math.min(Math.max(seconds, 60), 30 * 24 * 60 * 60)
      : 900;
  },
}));

const {
  autoModerate,
  banUser,
  deleteUserMessages,
  kickUser,
  ModerationError,
  muteUser,
  targetLabel,
  unbanUser,
  unmuteUser,
} = await import("../../src/services/moderation/actions.js");

const target = { id: 555, firstName: "Priya", username: "priya" };
const base = {
  chatId: -100123,
  target,
  actor: "admin" as const,
  reason: "spam",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.readChatMessageIds.mockResolvedValue([11, 12]);
  h.clearChatMessages.mockResolvedValue(undefined);
  h.upsertModeratedUser.mockResolvedValue(undefined);
  h.removeModeratedUser.mockResolvedValue(true);
  h.logModerationAction.mockResolvedValue(undefined);
  h.banChatMember.mockResolvedValue(true);
  h.unbanChatMember.mockResolvedValue(true);
  h.restrictChatMember.mockResolvedValue(true);
  h.deleteMessage.mockResolvedValue(true);
  h.deleteMessages.mockResolvedValue(true);
});

describe("moderation actions", () => {
  it("bans and clears the user's remembered messages", async () => {
    const result = await banUser(base);

    expect(h.banChatMember).toHaveBeenCalledWith({
      chat_id: -100123,
      user_id: 555,
      revoke_messages: true,
    });
    expect(h.deleteMessages).toHaveBeenCalledWith({
      chat_id: -100123,
      message_ids: [11, 12],
    });
    expect(h.clearChatMessages).toHaveBeenCalledWith(-100123, 555);
    expect(h.upsertModeratedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -100123,
        userId: 555,
        state: "banned",
        untilSeconds: null,
        reason: "spam",
        actor: "admin",
        firstName: "Priya",
      }),
    );
    expect(h.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ban", deletedCount: 2 }),
    );
    expect(result).toEqual({ action: "ban", deleted: 2 });
  });

  it("mutes for a duration, purges, and stores the lift time", async () => {
    const before = Date.now();
    const result = await muteUser({ ...base, seconds: 15 * 60 });
    const after = Date.now();

    const call = h.restrictChatMember.mock.calls[0]?.[0];
    if (!call) throw new Error("restrictChatMember was not called");
    expect(call.use_independent_chat_permissions).toBe(true);
    expect(call.permissions?.can_send_messages).toBe(false);
    expect(call.until_date).toBeGreaterThanOrEqual(
      Math.floor(before / 1000) + 900,
    );
    expect(call.until_date).toBeLessThanOrEqual(Math.floor(after / 1000) + 900);

    expect(h.upsertModeratedUser).toHaveBeenCalledWith(
      expect.objectContaining({ state: "muted", untilSeconds: 900 }),
    );
    expect(h.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mute", deletedCount: 2 }),
    );
    expect(result.deleted).toBe(2);
  });

  it("can mute without wiping the history (the automatic path)", async () => {
    await muteUser({ ...base, seconds: 60, purge: false });
    expect(h.deleteMessages).not.toHaveBeenCalled();
    expect(h.upsertModeratedUser).toHaveBeenCalled();
  });

  it("kicks by banning, clearing and lifting, and leaves no stored state", async () => {
    const result = await kickUser(base);

    expect(h.banChatMember).toHaveBeenCalledWith(
      expect.objectContaining({ revoke_messages: true }),
    );
    expect(h.unbanChatMember).toHaveBeenCalledWith({
      chat_id: -100123,
      user_id: 555,
      only_if_banned: true,
    });
    expect(h.removeModeratedUser).toHaveBeenCalledWith(-100123, 555);
    expect(h.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "kick" }),
    );
    expect(result.action).toBe("kick");
  });

  it("keeps the ban and says so when the kick cannot unban", async () => {
    h.unbanChatMember.mockRejectedValueOnce(
      new Error("Bad Request: not enough rights"),
    );

    await expect(kickUser(base)).rejects.toBeInstanceOf(ModerationError);
    expect(h.upsertModeratedUser).toHaveBeenCalledWith(
      expect.objectContaining({ state: "banned" }),
    );
    expect(h.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ban" }),
    );
  });

  it("lifts a ban and a mute, forgetting the stored state", async () => {
    await expect(unbanUser(base)).resolves.toEqual({
      action: "unban",
      deleted: 0,
    });
    await expect(unmuteUser(base)).resolves.toEqual({
      action: "unmute",
      deleted: 0,
    });

    expect(h.unbanChatMember).toHaveBeenCalled();
    expect(h.restrictChatMember).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: expect.objectContaining({ can_send_messages: true }),
      }),
    );
    expect(h.removeModeratedUser).toHaveBeenCalledTimes(2);
  });

  it("purges messages without touching membership", async () => {
    const result = await deleteUserMessages({
      ...base,
      extraIds: [12, 99],
    });

    expect(h.deleteMessages).toHaveBeenCalledWith({
      chat_id: -100123,
      message_ids: [11, 12, 99],
    });
    expect(h.banChatMember).not.toHaveBeenCalled();
    expect(h.restrictChatMember).not.toHaveBeenCalled();
    expect(result).toEqual({ action: "purge", deleted: 3 });
  });

  it("wraps a refused Telegram call in a readable error", async () => {
    h.banChatMember.mockRejectedValueOnce(
      new Error(
        "Bad Request: not enough rights to restrict/unrestrict chat member",
      ),
    );

    await expect(banUser(base)).rejects.toThrow(
      /admin with delete and restrict/,
    );
    expect(h.upsertModeratedUser).not.toHaveBeenCalled();
    expect(h.logModerationAction).not.toHaveBeenCalled();
  });

  it("labels a target from its name, handle or id", () => {
    expect(targetLabel(target)).toBe("Priya");
    expect(targetLabel({ id: 1, username: "someone" })).toBe("@someone");
    expect(targetLabel({ id: 7 })).toBe("7");
  });
});

describe("automatic moderation", () => {
  const settings = {
    enabled: true,
    autoDelete: true,
    autoMute: true,
    muteSeconds: 900,
    noticeInChat: true,
    notifyUser: true,
  };

  it("removes the message, mutes the sender and writes one audit line", async () => {
    const result = await autoModerate({
      chatId: -100123,
      target,
      messageId: 42,
      matched: ["sex"],
      settings,
    });

    expect(h.deleteMessage).toHaveBeenCalledWith({
      chat_id: -100123,
      message_id: 42,
    });
    expect(h.restrictChatMember).toHaveBeenCalled();
    expect(h.upsertModeratedUser).toHaveBeenCalledWith(
      expect.objectContaining({ state: "muted", actor: "auto" }),
    );
    expect(h.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auto_mute",
        deletedCount: 1,
        reason: expect.stringContaining("sex"),
      }),
    );
    expect(result).toEqual({ deleted: true, muted: true, muteError: null });
  });

  it("deletes only when muting is off", async () => {
    const result = await autoModerate({
      chatId: -100123,
      target,
      messageId: 42,
      matched: ["sex"],
      settings: { ...settings, autoMute: false },
    });

    expect(h.restrictChatMember).not.toHaveBeenCalled();
    expect(h.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auto_delete" }),
    );
    expect(result.muted).toBe(false);
  });

  it("mutes only when deleting is off", async () => {
    const result = await autoModerate({
      chatId: -100123,
      target,
      messageId: 42,
      matched: ["sex"],
      settings: { ...settings, autoDelete: false },
    });

    expect(h.deleteMessage).not.toHaveBeenCalled();
    expect(h.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auto_mute", deletedCount: 0 }),
    );
    expect(result.deleted).toBe(false);
  });

  it("keeps the deletion when the mute is refused", async () => {
    h.restrictChatMember.mockRejectedValueOnce(
      new Error("Bad Request: not enough rights"),
    );

    const result = await autoModerate({
      chatId: -100123,
      target,
      messageId: 42,
      matched: ["sex"],
      settings,
    });

    expect(result).toMatchObject({ deleted: true, muted: false });
    expect(result.muteError).toMatch(/rights/);
    expect(h.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auto_delete" }),
    );
  });
});
