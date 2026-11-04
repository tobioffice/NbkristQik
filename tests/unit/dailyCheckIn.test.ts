import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createOnMock,
  createOnTextMock,
  createSendMessageMock,
  registeredEventHandler,
  registeredTextHandler,
  replyKeyboard,
  sentMessage,
} from "../mocks/telegram.mock.js";

// Capture the handlers the module registers and the messages it sends instead
// of talking to Telegram.
const onText = createOnTextMock();
const on = createOnMock();
const sendMessage = createSendMessageMock(99);
const deleteMessage = vi.fn(async () => true);
const pinChatMessage = vi.fn(async () => true);
const answerCallbackQuery = vi.fn<
  (id: string, options?: { text?: string }) => Promise<boolean>
>(async () => true);

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    onText,
    on,
    sendMessage,
    deleteMessage,
    pinChatMessage,
    answerCallbackQuery,
  },
}));

const redisGet = vi.fn();
const redisSet = vi.fn(async () => "OK");
const redisSAdd = vi.fn(async () => 1);
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    get: redisGet,
    set: redisSet,
    sAdd: redisSAdd,
  })),
}));
vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
}));

const { secondsUntilMidnightIST } =
  await import("../../src/bot/dailyCheckIn.js");
const { CHECK_IN_PROMPT } = await import("../../src/bot/replies.js");

/** The /postcheckin handler and the "dailycheck" callback handler. */
const postcheckin = registeredTextHandler<(msg: unknown) => Promise<void>>(
  onText,
  "/postcheckin",
);
const dailycheck = registeredEventHandler<(query: unknown) => Promise<void>>(
  on,
  "callback_query",
);

const adminMsg = { chat: { id: 123456789 }, from: { id: 123456789 } };

describe("secondsUntilMidnightIST", () => {
  it("returns the seconds from a UTC morning to the next IST midnight", () => {
    // 2026-10-08 00:00 UTC = 05:30 IST -> 18.5h until IST midnight
    const now = new Date("2026-10-08T00:00:00Z");

    expect(secondsUntilMidnightIST(now)).toBe(18.5 * 60 * 60);
  });

  it("rolls over after IST midnight", () => {
    // 2026-10-08 19:00 UTC = 00:30 IST next day -> ~24h until the following midnight
    const now = new Date("2026-10-08T19:00:00Z");

    expect(secondsUntilMidnightIST(now)).toBe(23.5 * 60 * 60);
  });

  it("never returns less than the 60s floor", () => {
    // 2026-10-08 18:29:30 UTC = 23:59:30 IST -> 30s to midnight, floored to 60
    const now = new Date("2026-10-08T18:29:30Z");

    expect(secondsUntilMidnightIST(now)).toBe(60);
  });
});

describe("/postcheckin", () => {
  beforeEach(() => {
    redisGet.mockResolvedValue(null);
    sendMessage.mockResolvedValue({ message_id: 99 });
  });

  it("ignores non-admin callers", async () => {
    await postcheckin({ chat: { id: 5 }, from: { id: 5 } });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("posts and pins a daily check-in, not a CAPTCHA", async () => {
    await postcheckin(adminMsg);

    const [chatId, text, options] = sentMessage(sendMessage);
    expect(chatId).toBe("@test_channel");
    expect(text).toBe(CHECK_IN_PROMPT);
    expect(text.toLowerCase()).not.toContain("robot");
    expect(text.toLowerCase()).not.toContain("captcha");
    expect(replyKeyboard(options).inline_keyboard[0][0]).toEqual({
      text: "✅ Check in",
      callback_data: "dailycheck",
    });
    expect(pinChatMessage).toHaveBeenCalledWith("@test_channel", 99, {
      disable_notification: true,
    });
    // the admin's confirmation must not claim a gate is active
    const [, confirmation] = sentMessage(sendMessage, 1);
    expect(confirmation).toContain("Daily check-in");
    expect(confirmation).not.toContain("Gate");
  });
});

describe("the dailycheck callback", () => {
  beforeEach(() => {
    redisSet.mockClear();
    answerCallbackQuery.mockClear();
  });

  it("answers 'all set' without promising an unlock link", async () => {
    await dailycheck({
      id: "cb-1",
      data: "dailycheck",
      from: { id: 77, first_name: "Student", username: "student" },
      message: { chat: { type: "channel" } },
    });

    expect(answerCallbackQuery).toHaveBeenCalledWith("cb-1", {
      text: "✅ You're all set!",
    });
    expect(JSON.stringify(answerCallbackQuery.mock.calls[0][1])).not.toContain(
      "t.me",
    );
  });

  it("records the day in Redis and keeps the broadcast list", async () => {
    await dailycheck({
      id: "cb-2",
      data: "dailycheck",
      from: { id: 78, first_name: "Student" },
      message: { chat: { type: "channel" } },
    });

    expect(redisSet).toHaveBeenCalledWith("dailyUnlocked:78", "1", {
      EX: expect.any(Number),
    });
    expect(redisSAdd).toHaveBeenCalledWith("qik:users", "78");
  });
});
