import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramApiError } from "node-telegram-bot-api";

/**
 * The channel posting path: rich first, text only on a refusal.
 *
 * A refusal is a 400 from Telegram (the rich form was rejected before it could
 * be delivered). A network or server failure is rethrown instead of retried,
 * because it may already have posted the card and the channel must never see
 * the same card twice.
 */

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(async (_params: Record<string, unknown>) => ({
    message_id: 100,
  })),
  sendRichMessage: vi.fn(async (_params: Record<string, unknown>) => ({
    message_id: 101,
  })),
  command: vi.fn(),
}));

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    api: {
      sendMessage: mocks.sendMessage,
      sendRichMessage: mocks.sendRichMessage,
    },
    command: mocks.command,
  },
}));

const { isRichRefusal, postCard } = await import("../../src/games/channel.js");

const richCard = {
  text: "Fallback text",
  rich: "<p>Rich card</p>",
  markup: {
    inline_keyboard: [
      [{ text: "Play today's run", url: "https://t.me/test_bot?start=quiz" }],
    ],
  },
};

beforeEach(() => {
  mocks.sendMessage.mockClear();
  mocks.sendRichMessage.mockClear();
});

describe("the channel post path", () => {
  it("sends the rich form when the card has one", async () => {
    await postCard("@test_channel", richCard);

    expect(mocks.sendRichMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.sendRichMessage.mock.calls[0][0]).toMatchObject({
      chat_id: "@test_channel",
      rich_message: { html: "<p>Rich card</p>" },
      reply_markup: richCard.markup,
    });
  });

  it("falls back to the text card when the rich form is refused", async () => {
    mocks.sendRichMessage.mockRejectedValueOnce(
      new TelegramApiError(
        400,
        "Bad Request: rich messages are not supported here",
      ),
    );

    await postCard("@test_channel", richCard);

    expect(mocks.sendRichMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage.mock.calls[0][0]).toMatchObject({
      chat_id: "@test_channel",
      text: "Fallback text",
      parse_mode: "HTML",
      reply_markup: richCard.markup,
    });
  });

  it("posts plain text when there is no rich form", async () => {
    await postCard(123, { text: "Plain card" });

    expect(mocks.sendRichMessage).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage.mock.calls[0][0]).toMatchObject({
      chat_id: 123,
      text: "Plain card",
    });
  });

  it("rethrows a failure that may already have delivered the post", async () => {
    mocks.sendRichMessage.mockRejectedValueOnce(new Error("fetch failed"));

    await expect(postCard("@test_channel", richCard)).rejects.toThrow(
      "fetch failed",
    );
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
