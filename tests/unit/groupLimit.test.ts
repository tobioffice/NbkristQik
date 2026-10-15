import { describe, it, expect, vi, beforeEach } from "vitest";

// in-memory stand-in for the groupUses counter
const store = new Map<string, number>();
const sendMessage = vi.fn(async () => ({ message_id: 7 }));

vi.mock("../../src/bot/bot.js", () => ({ bot: { sendMessage } }));
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    incr: vi.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    }),
  })),
}));

process.env.ADMIN_ID = "777";

const { checkGroupUse, GROUP_USE_LIMIT } = await import(
  "../../src/bot/groupLimit.js"
);

const GROUP = -100;
const PRIVATE = 42;

describe("checkGroupUse", () => {
  beforeEach(() => {
    store.clear();
    sendMessage.mockClear();
  });

  it("lets private chats through without touching the counter", async () => {
    await expect(checkGroupUse(1, PRIVATE)).resolves.toBe(true);
    await expect(checkGroupUse(1, PRIVATE)).resolves.toBe(true);

    expect(store.size).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("lets the admin through in groups without counting", async () => {
    await expect(checkGroupUse(777, GROUP)).resolves.toBe(true);

    expect(store.size).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it(`allows ${GROUP_USE_LIMIT} group answers, then redirects with a Start button`, async () => {
    for (let i = 0; i < GROUP_USE_LIMIT; i++) {
      await expect(checkGroupUse(5, GROUP, 99)).resolves.toBe(true);
    }
    expect(sendMessage).not.toHaveBeenCalled();

    await expect(checkGroupUse(5, GROUP, 99)).resolves.toBe(false);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = sendMessage.mock.calls[0];
    expect(chatId).toBe(GROUP);
    expect(text).toContain("2 checks");
    expect(text).toMatch(/discussion/i);
    expect(opts.reply_to_message_id).toBe(99);
    const button = opts.reply_markup.inline_keyboard[0][0];
    expect(button.url).toContain("https://t.me/");
    expect(button.url).toContain("start=");
  });

  it("fails open when Redis is down", async () => {
    const { getClient } = await import(
      "../../src/services/redis/getRedisClient.js"
    );
    vi.mocked(getClient).mockRejectedValueOnce(new Error("redis down"));

    await expect(checkGroupUse(9, GROUP)).resolves.toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
