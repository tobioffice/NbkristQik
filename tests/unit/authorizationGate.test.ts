import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSendMessageMock,
  replyKeyboard,
  sentMessage,
} from "../mocks/telegram.mock.js";

// The gate talks to Telegram and to the channel-membership services; both are
// captured here. Redis is shared by the membership cache and, before the fix,
// by the daily check-in gate.
const sendMessage = createSendMessageMock();
vi.mock("../../src/bot/bot.js", () => ({ bot: { sendMessage } }));

const checkMembership = vi.fn(async () => true);
vi.mock("../../src/services/student.utils/checkMembership.js", () => ({
  checkMembership,
}));

const redisGet = vi.fn();
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({ get: redisGet, sAdd: vi.fn() })),
}));

const { isAuthorizedUser } = await import("../../src/bot/authorization.js");
const { ADMIN_ID } = await import("../../src/config/environmentals.js");
const { JOIN_CHANNEL } = await import("../../src/bot/replies.js");

beforeEach(() => {
  checkMembership.mockResolvedValue(true);
});

describe("authorization after the check-in gate was retired", () => {
  it("answers a channel member even when a pinned check-in post exists", async () => {
    // a post exists, and this student never tapped it: the old gate would
    // have stopped here
    redisGet.mockImplementation(async (key: string) =>
      key === "checkin:post:msgId"
        ? "999"
        : key === "isMember:42"
          ? "true"
          : null,
    );

    await expect(isAuthorizedUser({ userId: 42, chatId: 42 })).resolves.toBe(
      true,
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("still asks a non-member to join the channel", async () => {
    redisGet.mockResolvedValue(null);
    checkMembership.mockResolvedValue(false);

    await expect(isAuthorizedUser({ userId: 43, chatId: 43 })).resolves.toBe(
      false,
    );

    const [chatId, text, options] = sentMessage(sendMessage);
    expect(chatId).toBe(43);
    expect(text).toBe(JOIN_CHANNEL);
    expect(replyKeyboard(options).inline_keyboard[0][0].url).toContain(
      "t.me/test_channel",
    );
  });

  it("lets the admin through without touching membership", async () => {
    await expect(
      isAuthorizedUser({ userId: ADMIN_ID, chatId: 5 }),
    ).resolves.toBe(true);
    expect(redisGet).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("fails open when membership cannot be checked", async () => {
    redisGet.mockRejectedValue(new Error("redis down"));
    checkMembership.mockRejectedValue(new Error("telegram down"));

    await expect(isAuthorizedUser({ userId: 44, chatId: 44 })).resolves.toBe(
      true,
    );
  });
});
