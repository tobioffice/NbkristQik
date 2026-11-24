import { beforeEach, describe, expect, it, vi } from "vitest";

const CHAT = -100555;
const OWNER = 123;

const h = vi.hoisted(() => ({
  on: vi.fn(),
  sendMessage: vi.fn(),
  autoModerate: vi.fn(),
  banUser: vi.fn(),
  muteUser: vi.fn(),
  kickUser: vi.fn(),
  unbanUser: vi.fn(),
  unmuteUser: vi.fn(),
  deleteUserMessages: vi.fn(),
  matchBlockedWords: vi.fn(),
  getModerationSettings: vi.fn(),
  isChatAdmin: vi.fn(),
  botUserId: vi.fn(),
  deleteMessageQuietly: vi.fn(),
  logChatMessage: vi.fn(),
  removeChatMessage: vi.fn(),
  getModeratedUser: vi.fn(),
}));

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    on: h.on,
    api: { sendMessage: h.sendMessage },
  },
}));

vi.mock("../../src/config/environmentals.js", () => ({
  ENV: "test",
  ADMIN_ID: 123,
  MODERATION_CHAT_IDS: [-100555],
}));

vi.mock("../../src/db/chatModeration.model.js", () => ({
  getModeratedUser: h.getModeratedUser,
  logChatMessage: h.logChatMessage,
  removeChatMessage: h.removeChatMessage,
}));

vi.mock("../../src/services/moderation/actions.js", () => ({
  autoModerate: h.autoModerate,
  banUser: h.banUser,
  muteUser: h.muteUser,
  kickUser: h.kickUser,
  unbanUser: h.unbanUser,
  unmuteUser: h.unmuteUser,
  deleteUserMessages: h.deleteUserMessages,
  targetLabel: (target: {
    firstName?: string;
    username?: string;
    id: number;
  }) =>
    target.firstName ||
    (target.username ? `@${target.username}` : String(target.id)),
  ModerationError: class ModerationError extends Error {},
}));

vi.mock("../../src/services/moderation/keywords.js", () => ({
  matchBlockedWords: h.matchBlockedWords,
}));

vi.mock("../../src/services/moderation/settings.js", () => ({
  getModerationSettings: h.getModerationSettings,
  clampMuteSeconds: (value: unknown) => {
    const seconds = Math.trunc(Number(value));
    return Number.isFinite(seconds)
      ? Math.min(Math.max(seconds, 60), 30 * 24 * 60 * 60)
      : 900;
  },
  MUTE_SECONDS_MIN: 60,
  MUTE_SECONDS_MAX: 30 * 24 * 60 * 60,
}));

vi.mock("../../src/services/moderation/telegram.js", () => ({
  botUserId: h.botUserId,
  deleteMessageQuietly: h.deleteMessageQuietly,
  isChatAdmin: h.isChatAdmin,
  telegramErrorText: (error: unknown) => String(error),
}));

const { ModerationError } =
  await import("../../src/services/moderation/actions.js");
await import("../../src/bot/moderation.js");

type Handler = (
  ctx: { message?: unknown; editedMessage?: unknown },
  next: () => Promise<void>,
) => Promise<void>;

const handlerFor = (kind: string): Handler => {
  const call = h.on.mock.calls.find(([name]) => name === kind);
  if (!call) throw new Error(`no handler for ${kind}`);
  return call[1] as unknown as Handler;
};

const messageHandler = handlerFor("message");
const editedHandler = handlerFor("edited_message");

const settings = {
  enabled: true,
  autoDelete: true,
  autoMute: true,
  muteSeconds: 900,
  noticeInChat: true,
  notifyUser: true,
};

const settingsDisabled = { ...settings, enabled: false };

interface MessageOverrides {
  chatId?: number;
  text?: string;
  from?: {
    id: number;
    first_name?: string;
    username?: string;
    is_bot?: boolean;
  };
  replyTo?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
  };
}

const message = (overrides: MessageOverrides = {}) => ({
  message_id: 50,
  chat: { id: overrides.chatId ?? CHAT, type: "supergroup" },
  from: overrides.from ?? { id: 777, first_name: "Asha", is_bot: false },
  text: overrides.text ?? "hello",
  ...(overrides.replyTo ? { reply_to_message: overrides.replyTo } : {}),
});

const next = () => vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  h.sendMessage.mockResolvedValue({ message_id: 100 });
  h.autoModerate.mockResolvedValue({
    deleted: true,
    muted: true,
    muteError: null,
  });
  h.banUser.mockResolvedValue({ action: "ban", deleted: 2 });
  h.muteUser.mockResolvedValue({
    action: "mute",
    deleted: 0,
    until: new Date(Date.now() + 900_000),
  });
  h.kickUser.mockResolvedValue({ action: "kick", deleted: 1 });
  h.unbanUser.mockResolvedValue({ action: "unban", deleted: 0 });
  h.unmuteUser.mockResolvedValue({ action: "unmute", deleted: 0 });
  h.deleteUserMessages.mockResolvedValue({ action: "purge", deleted: 3 });
  h.matchBlockedWords.mockResolvedValue([]);
  h.getModerationSettings.mockResolvedValue(settings);
  h.isChatAdmin.mockResolvedValue(false);
  h.botUserId.mockResolvedValue(999);
  h.deleteMessageQuietly.mockResolvedValue(true);
  h.logChatMessage.mockResolvedValue(undefined);
  h.removeChatMessage.mockResolvedValue(undefined);
  h.getModeratedUser.mockResolvedValue(null);
});

describe("chat regulation message flow", () => {
  it("removes a blocked message and hands the update on", async () => {
    h.matchBlockedWords.mockResolvedValue(["sex"]);
    const proceed = next();

    await messageHandler({ message: message({ text: "s e x" }) }, proceed);

    expect(h.autoModerate).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT,
        messageId: 50,
        matched: ["sex"],
      }),
    );
    expect(proceed).toHaveBeenCalled();
  });

  it("leaves an unregulated chat alone", async () => {
    const proceed = next();
    await messageHandler(
      { message: message({ chatId: -100999, text: "sex" }) },
      proceed,
    );

    expect(h.autoModerate).not.toHaveBeenCalled();
    expect(h.matchBlockedWords).not.toHaveBeenCalled();
    expect(proceed).toHaveBeenCalled();
  });

  it("does not moderate the owner or a group admin", async () => {
    h.matchBlockedWords.mockResolvedValue(["sex"]);

    await messageHandler(
      { message: message({ from: { id: OWNER, is_bot: false }, text: "sex" }) },
      next(),
    );
    expect(h.autoModerate).not.toHaveBeenCalled();

    h.isChatAdmin.mockResolvedValue(true);
    await messageHandler({ message: message({ text: "sex" }) }, next());
    expect(h.autoModerate).not.toHaveBeenCalled();
  });

  it("fails open when Telegram cannot answer who the admins are", async () => {
    h.matchBlockedWords.mockResolvedValue(["sex"]);
    h.isChatAdmin.mockResolvedValue(null);

    await messageHandler({ message: message({ text: "sex" }) }, next());

    expect(h.autoModerate).not.toHaveBeenCalled();
  });

  it("respects the disabled switch and the clean-message fast path", async () => {
    h.matchBlockedWords.mockResolvedValue(["sex"]);
    h.getModerationSettings.mockResolvedValue(settingsDisabled);
    await messageHandler({ message: message({ text: "sex" }) }, next());
    expect(h.matchBlockedWords).not.toHaveBeenCalled();
    expect(h.autoModerate).not.toHaveBeenCalled();

    h.getModerationSettings.mockResolvedValue(settings);
    h.matchBlockedWords.mockResolvedValue([]);
    await messageHandler(
      { message: message({ text: "good morning" }) },
      next(),
    );
    expect(h.autoModerate).not.toHaveBeenCalled();
  });

  it("only deletes extra messages from someone already restricted", async () => {
    h.matchBlockedWords.mockResolvedValue(["sex"]);
    h.getModeratedUser.mockResolvedValue({ state: "muted" });

    await messageHandler({ message: message({ text: "sex" }) }, next());

    expect(h.deleteMessageQuietly).toHaveBeenCalledWith(CHAT, 50);
    expect(h.autoModerate).not.toHaveBeenCalled();
  });

  it("checks an edited message again", async () => {
    h.matchBlockedWords.mockResolvedValue(["sex"]);
    const proceed = next();

    await editedHandler({ editedMessage: message({ text: "sex" }) }, proceed);

    expect(h.autoModerate).toHaveBeenCalled();
    expect(proceed).toHaveBeenCalled();
  });
});

describe("admin reply commands", () => {
  const command = (text: string, replyTo?: MessageOverrides["replyTo"]) => ({
    message: message({
      text,
      from: { id: OWNER, first_name: "Admin", is_bot: false },
      replyTo,
    }),
  });

  it("bans the replied-to author and confirms in the chat", async () => {
    const proceed = next();
    await messageHandler(
      command("/ban spam", {
        message_id: 49,
        from: { id: 777, first_name: "Asha" },
      }),
      proceed,
    );

    expect(h.banUser).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT,
        target: expect.objectContaining({ id: 777 }),
        actor: "admin",
        reason: "spam",
      }),
    );
    const sent = h.sendMessage.mock.calls[0]?.[0] as { text: string };
    expect(sent.text).toContain("Banned Asha");
    expect(sent.text).toContain("2 messages removed");
    expect(proceed).not.toHaveBeenCalled();
  });

  it("asks for a reply when the command is not a reply", async () => {
    await messageHandler(command("/ban"), next());

    expect(h.banUser).not.toHaveBeenCalled();
    const sent = h.sendMessage.mock.calls[0]?.[0] as { text: string };
    expect(sent.text).toMatch(/Reply to the message/);
  });

  it("refuses to act on its own message or the admin's own message", async () => {
    await messageHandler(
      command("/ban", { message_id: 49, from: { id: 999 } }),
      next(),
    );
    expect(h.banUser).not.toHaveBeenCalled();
    expect((h.sendMessage.mock.calls[0]?.[0] as { text: string }).text).toMatch(
      /That one's me/,
    );

    h.sendMessage.mockClear();
    await messageHandler(
      command("/ban", { message_id: 49, from: { id: OWNER } }),
      next(),
    );
    expect(h.banUser).not.toHaveBeenCalled();
    expect((h.sendMessage.mock.calls[0]?.[0] as { text: string }).text).toMatch(
      /your own message/,
    );
  });

  it("mutes for the requested duration", async () => {
    await messageHandler(
      command("/mute 2h rude", {
        message_id: 49,
        from: { id: 777, first_name: "Asha" },
      }),
      next(),
    );

    expect(h.muteUser).toHaveBeenCalledWith(
      expect.objectContaining({ seconds: 7200, reason: "rude" }),
    );
    const sent = h.sendMessage.mock.calls[0]?.[0] as { text: string };
    expect(sent.text).toMatch(/Muted Asha for 2 hours/);
  });

  it("kicks, purges and lifts restrictions on request", async () => {
    await messageHandler(
      command("/kick", { message_id: 49, from: { id: 777 } }),
      next(),
    );
    await messageHandler(
      command("/purge", { message_id: 49, from: { id: 777 } }),
      next(),
    );
    await messageHandler(
      command("/unban", { message_id: 49, from: { id: 777 } }),
      next(),
    );
    await messageHandler(
      command("/unmute", { message_id: 49, from: { id: 777 } }),
      next(),
    );

    expect(h.kickUser).toHaveBeenCalled();
    expect(h.deleteUserMessages).toHaveBeenCalledWith(
      expect.objectContaining({ extraIds: [49] }),
    );
    expect(h.unbanUser).toHaveBeenCalled();
    expect(h.unmuteUser).toHaveBeenCalled();
  });

  it("reports a Telegram refusal instead of throwing", async () => {
    h.banUser.mockRejectedValueOnce(
      new ModerationError("The bot doesn't have the rights for that here."),
    );

    await expect(
      messageHandler(
        command("/ban", { message_id: 49, from: { id: 777 } }),
        next(),
      ),
    ).resolves.toBeUndefined();

    const sent = h.sendMessage.mock.calls[0]?.[0] as { text: string };
    expect(sent.text).toMatch(/have the rights/);
  });

  it("ignores a student typing a moderation command", async () => {
    await messageHandler(
      {
        message: message({
          text: "/ban",
          from: { id: 777, is_bot: false },
          replyTo: { message_id: 49, from: { id: 555 } },
        }),
      },
      next(),
    );

    expect(h.banUser).not.toHaveBeenCalled();
    expect(h.sendMessage).not.toHaveBeenCalled();
  });
});
