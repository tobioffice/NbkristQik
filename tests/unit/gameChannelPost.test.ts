import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramApiError } from "node-telegram-bot-api";

/**
 * The channel's single live board.
 *
 * One message is posted, then edited in place only when the data fingerprint
 * changes. The stored row is the only memory, so a restart edits the same
 * message instead of posting a second one.
 */

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(async (_params: Record<string, unknown>) => ({
    message_id: 100,
  })),
  sendRichMessage: vi.fn(async (_params: Record<string, unknown>) => ({
    message_id: 101,
  })),
  editMessageText: vi.fn(async (_params: Record<string, unknown>) => true),
  deleteMessage: vi.fn(async (_params: Record<string, unknown>) => true),
  command: vi.fn(),
  getChannelBoard: vi.fn(),
  saveChannelBoard: vi.fn(async (_state: Record<string, unknown>) => undefined),
  clearChannelBoard: vi.fn(async (_slot: string) => undefined),
  getWeekPlayers: vi.fn(),
  getWeekSections: vi.fn(),
}));

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    api: {
      sendMessage: mocks.sendMessage,
      sendRichMessage: mocks.sendRichMessage,
      editMessageText: mocks.editMessageText,
      deleteMessage: mocks.deleteMessage,
    },
    command: mocks.command,
  },
}));

vi.mock("../../src/db/game.model.js", () => ({
  getChannelBoard: mocks.getChannelBoard,
  saveChannelBoard: mocks.saveChannelBoard,
  clearChannelBoard: mocks.clearChannelBoard,
  getWeekPlayers: mocks.getWeekPlayers,
  getWeekSections: mocks.getWeekSections,
}));

// The identity lookups have their own tests; these cover the sync path.
vi.mock("../../src/games/identity.js", () => ({
  withBoardIdentities: vi.fn(async (players: unknown[]) => players),
}));

const {
  isRichRefusal,
  liveBoardSnapshot,
  postCard,
  repostLiveBoard,
  syncLiveBoard,
} = await import("../../src/games/channel.js");
const { weekLabel } = await import("../../src/games/cards.js");
const { istStamp } = await import("../../src/games/time.js");

const label = weekLabel(istStamp().monday);

const gamepostCommand = mocks.command.mock.calls.find(
  ([name]) => name === "gamepost",
)?.[1] as ((ctx: unknown) => Promise<void>) | undefined;

const board = {
  label,
  players: [
    {
      userId: 1,
      rollNo: "23KB1A0599",
      displayName: "Asha",
      points: 2_100,
    },
  ],
  sections: [{ key: "4|CSE|C", label: "4 CSE C", points: 4_820, players: 9 }],
};

const stored = {
  chatId: "@test_channel",
  messageId: 101,
  snapshot: "an older fingerprint",
  updatedAt: "2026-11-15T10:00:00.000Z",
};

beforeEach(() => {
  mocks.sendMessage.mockClear();
  mocks.sendRichMessage.mockClear();
  mocks.editMessageText.mockClear();
  mocks.deleteMessage.mockClear();
  mocks.saveChannelBoard.mockClear();
  mocks.clearChannelBoard.mockClear();
  mocks.getChannelBoard.mockReset();
  mocks.getChannelBoard.mockResolvedValue(null);
  mocks.getWeekPlayers.mockReset();
  mocks.getWeekPlayers.mockResolvedValue(board.players);
  mocks.getWeekSections.mockReset();
  mocks.getWeekSections.mockResolvedValue(board.sections);
});

describe("syncLiveBoard", () => {
  it("posts the board once, then remembers the message id", async () => {
    expect(await syncLiveBoard()).toBe("created");

    expect(mocks.sendRichMessage).toHaveBeenCalledTimes(1);
    const sent = mocks.sendRichMessage.mock.calls[0][0] as {
      chat_id: string;
      rich_message: { html: string };
    };
    expect(sent.chat_id).toBe("@test_channel");
    expect(sent.rich_message.html).toContain("<b>Students</b>");
    expect(sent.rich_message.html).toContain("<b>Sections</b>");
    expect(sent.rich_message.html).toContain("2,100");
    expect(sent.rich_message.html).toContain("4,820");

    expect(mocks.saveChannelBoard).toHaveBeenCalledTimes(1);
    expect(mocks.saveChannelBoard.mock.calls[0][0]).toMatchObject({
      slot: "live",
      chatId: "@test_channel",
      messageId: 101,
      snapshot: liveBoardSnapshot(board),
    });
  });

  it("does not touch Telegram when the fingerprint is unchanged", async () => {
    mocks.getChannelBoard.mockResolvedValue({
      ...stored,
      snapshot: liveBoardSnapshot(board),
    });

    expect(await syncLiveBoard()).toBe("unchanged");

    expect(mocks.sendRichMessage).not.toHaveBeenCalled();
    expect(mocks.editMessageText).not.toHaveBeenCalled();
    expect(mocks.saveChannelBoard).not.toHaveBeenCalled();
  });

  it("edits the same message when the numbers moved", async () => {
    mocks.getChannelBoard.mockResolvedValue(stored);

    expect(await syncLiveBoard()).toBe("edited");

    expect(mocks.sendRichMessage).not.toHaveBeenCalled();
    expect(mocks.editMessageText).toHaveBeenCalledTimes(1);
    const edit = mocks.editMessageText.mock.calls[0][0] as {
      chat_id: string;
      message_id: number;
      rich_message: { html: string };
    };
    expect(edit.chat_id).toBe("@test_channel");
    expect(edit.message_id).toBe(101);
    expect(edit.rich_message.html).toContain("2,100");

    expect(mocks.saveChannelBoard).toHaveBeenCalledTimes(1);
    expect(mocks.saveChannelBoard.mock.calls[0][0]).toMatchObject({
      messageId: 101,
      snapshot: liveBoardSnapshot(board),
    });
  });

  it("posts a new message when the stored one was deleted", async () => {
    mocks.getChannelBoard.mockResolvedValue(stored);
    mocks.editMessageText.mockRejectedValueOnce(
      new TelegramApiError(400, "Bad Request: message to edit not found"),
    );
    mocks.sendRichMessage.mockResolvedValueOnce({ message_id: 202 });

    expect(await syncLiveBoard()).toBe("created");

    expect(mocks.sendRichMessage).toHaveBeenCalledTimes(1);
    expect(mocks.saveChannelBoard).toHaveBeenCalledTimes(1);
    expect(mocks.saveChannelBoard.mock.calls[0][0]).toMatchObject({
      messageId: 202,
    });
  });

  it("leaves the row alone when the edit fails for another reason", async () => {
    mocks.getChannelBoard.mockResolvedValue(stored);
    mocks.editMessageText.mockRejectedValueOnce(new Error("fetch failed"));

    await expect(syncLiveBoard()).rejects.toThrow("fetch failed");
    expect(mocks.saveChannelBoard).not.toHaveBeenCalled();
  });

  it("reposts when the configured channel changed", async () => {
    mocks.getChannelBoard.mockResolvedValue({
      ...stored,
      chatId: "@old_channel",
      snapshot: liveBoardSnapshot(board),
    });

    expect(await syncLiveBoard()).toBe("created");
    expect(mocks.sendRichMessage).toHaveBeenCalledTimes(1);
    expect(mocks.editMessageText).not.toHaveBeenCalled();
  });
});

describe("repostLiveBoard", () => {
  it("deletes the stored message and posts a fresh one", async () => {
    mocks.getChannelBoard.mockResolvedValueOnce(stored);
    mocks.sendRichMessage.mockResolvedValueOnce({ message_id: 202 });

    expect(await repostLiveBoard()).toBe("created");

    expect(mocks.deleteMessage).toHaveBeenCalledWith({
      chat_id: "@test_channel",
      message_id: 101,
    });
    expect(mocks.clearChannelBoard).toHaveBeenCalledWith("live");
    expect(mocks.sendRichMessage).toHaveBeenCalledTimes(1);
    expect(mocks.saveChannelBoard.mock.calls[0][0]).toMatchObject({
      messageId: 202,
    });
  });

  it("posts without deleting when no board was stored", async () => {
    expect(await repostLiveBoard()).toBe("created");

    expect(mocks.deleteMessage).not.toHaveBeenCalled();
    expect(mocks.clearChannelBoard).not.toHaveBeenCalled();
    expect(mocks.sendRichMessage).toHaveBeenCalledTimes(1);
  });

  it("treats an already-deleted message as fine", async () => {
    mocks.getChannelBoard.mockResolvedValueOnce(stored);
    mocks.deleteMessage.mockRejectedValueOnce(
      new TelegramApiError(400, "Bad Request: message to delete not found"),
    );

    expect(await repostLiveBoard()).toBe("created");
    expect(mocks.sendRichMessage).toHaveBeenCalledTimes(1);
  });

  it("does not post a duplicate when the delete is refused", async () => {
    mocks.getChannelBoard.mockResolvedValueOnce(stored);
    mocks.deleteMessage.mockRejectedValueOnce(
      new TelegramApiError(403, "Forbidden: not enough rights to delete"),
    );

    await expect(repostLiveBoard()).rejects.toThrow("not enough rights");
    expect(mocks.sendRichMessage).not.toHaveBeenCalled();
    expect(mocks.clearChannelBoard).not.toHaveBeenCalled();
  });
});

describe("the /gamepost command", () => {
  it("reposts from /gamepost repost", async () => {
    mocks.getChannelBoard.mockResolvedValueOnce(stored);

    await gamepostCommand?.({
      match: "repost",
      message: {
        message_id: 9,
        chat: { id: 5, type: "private" },
        from: { id: Number(process.env.ADMIN_ID), is_bot: false },
        date: 0,
        text: "/gamepost repost",
      },
    });

    expect(mocks.deleteMessage).toHaveBeenCalledWith({
      chat_id: "@test_channel",
      message_id: 101,
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chat_id: 5 }),
    );
  });
});

describe("postCard", () => {
  it("returns the rich message id", async () => {
    const card = {
      text: "Fallback text",
      rich: "<p>Rich card</p>",
      markup: {
        inline_keyboard: [
          [
            {
              text: "Play today's run",
              url: "https://t.me/test_bot?start=quiz",
            },
          ],
        ],
      },
    };

    expect(await postCard("@test_channel", card)).toBe(101);
    expect(mocks.sendRichMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("falls back to the text card when the rich form is refused", async () => {
    mocks.sendRichMessage.mockRejectedValueOnce(
      new TelegramApiError(400, "Bad Request: rich messages are not supported"),
    );

    const messageId = await postCard("@test_channel", {
      text: "Fallback text",
      rich: "<p>Rich card</p>",
    });

    expect(messageId).toBe(100);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage.mock.calls[0][0]).toMatchObject({
      chat_id: "@test_channel",
      text: "Fallback text",
      parse_mode: "HTML",
    });
  });

  it("rethrows a failure that may already have delivered the post", async () => {
    mocks.sendRichMessage.mockRejectedValueOnce(new Error("fetch failed"));

    await expect(
      postCard("@test_channel", { text: "Fallback", rich: "<p>Rich</p>" }),
    ).rejects.toThrow("fetch failed");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});

describe("isRichRefusal", () => {
  it("only treats a 400 as a safe-to-retry refusal", () => {
    expect(isRichRefusal(new TelegramApiError(400, "Bad Request"))).toBe(true);
    expect(isRichRefusal(new TelegramApiError(403, "Forbidden"))).toBe(false);
    expect(isRichRefusal(new TelegramApiError(429, "Too Many Requests"))).toBe(
      false,
    );
    expect(isRichRefusal(new Error("fetch failed"))).toBe(false);
    expect(isRichRefusal(undefined)).toBe(false);
  });
});
