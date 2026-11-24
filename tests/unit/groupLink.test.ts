import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "node-telegram-bot-api";

/**
 * The group prompt's timer.
 *
 * The "open it in the bot" prompt exists only to carry a student into the DM.
 * A tap clears it immediately; a prompt nobody taps is swept up after its
 * lifetime so the room does not keep the roll and the reply forever.
 */

const { sendMessage, deleteMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn(async () => ({ message_id: 100 })),
  deleteMessage: vi.fn(async () => true),
}));

vi.mock("../../src/bot/bot.js", () => ({
  bot: { api: { sendMessage, deleteMessage } },
}));

const { sendPrivateCardLink, GROUP_PROMPT_LIFETIME_MS } =
  await import("../../src/bot/academics/groupLink.js");
const { takeGroupPrompts } =
  await import("../../src/bot/academics/groupPrompt.js");

const groupMessage = (messageId = 7): Message =>
  ({
    message_id: messageId,
    chat: { id: -100200, type: "supergroup" },
    from: { id: 42 },
    text: "25KB1A05AR",
  }) as unknown as Message;

beforeEach(() => {
  vi.useFakeTimers();
  sendMessage.mockClear();
  sendMessage.mockResolvedValue({ message_id: 100 });
  deleteMessage.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a group prompt with no tap", () => {
  it("is swept up with the roll message after its lifetime", async () => {
    await sendPrivateCardLink(groupMessage(7), "25KB1A05AR", "att");

    expect(deleteMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(GROUP_PROMPT_LIFETIME_MS);

    expect(deleteMessage).toHaveBeenCalledWith({
      chat_id: -100200,
      message_id: 100,
    });
    expect(deleteMessage).toHaveBeenCalledWith({
      chat_id: -100200,
      message_id: 7,
    });
    // the bookkeeping is gone, so a late /start has nothing left to clear
    expect(takeGroupPrompts(42, "25KB1A05AR")).toEqual([]);
  });

  it("leaves nothing for the timer once the deep link cleared it", async () => {
    await sendPrivateCardLink(groupMessage(7), "25KB1A05AR", "att");

    // the student tapped: /start takes the prompt before the timer fires
    takeGroupPrompts(42, "25KB1A05AR");
    vi.advanceTimersByTime(GROUP_PROMPT_LIFETIME_MS);

    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it("sweeps only its own prompt when a roll was sent twice", async () => {
    sendMessage
      .mockResolvedValueOnce({ message_id: 100 })
      .mockResolvedValueOnce({ message_id: 101 });

    await sendPrivateCardLink(groupMessage(7), "25KB1A05AR", "att");
    await sendPrivateCardLink(groupMessage(9), "25KB1A05AR", "att");

    vi.advanceTimersByTime(GROUP_PROMPT_LIFETIME_MS);

    expect(deleteMessage).toHaveBeenCalledTimes(4);
    expect(deleteMessage).toHaveBeenCalledWith({
      chat_id: -100200,
      message_id: 100,
    });
    expect(deleteMessage).toHaveBeenCalledWith({
      chat_id: -100200,
      message_id: 7,
    });
    expect(deleteMessage).toHaveBeenCalledWith({
      chat_id: -100200,
      message_id: 101,
    });
    expect(deleteMessage).toHaveBeenCalledWith({
      chat_id: -100200,
      message_id: 9,
    });
  });
});
