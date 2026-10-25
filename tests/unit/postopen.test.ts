import { describe, it, expect, vi, beforeEach } from "vitest";

// capture the handler the command module registers instead of talking to
// Telegram, and the messages it sends
const onText = vi.fn();
const sendMessage = vi.fn(async () => ({ message_id: 3 }));

vi.mock("../../src/bot/bot.js", () => ({ bot: { onText, sendMessage } }));
vi.mock("../../src/services/tracker.js", () => ({ trackMessage: vi.fn() }));

process.env.ADMIN_ID = "777";
process.env.TEST_CHANNEL = "-100123";

await import("../../src/bot/commands/postopen.js");
const { POSTOPEN_TEXT, POSTOPEN_BUTTON_TEXT } =
  await import("../../src/bot/commands/postopen.js");

/** The /postopen handler (admin-only, no arguments). */
const postopen = onText.mock.calls.find(([pattern]: [RegExp]) =>
  pattern.test("/postopen"),
)?.[1] as (msg: unknown) => Promise<void>;

const adminMsg = { chat: { id: 777 }, from: { id: 777 } };

describe("/postopen", () => {
  beforeEach(() => {
    sendMessage.mockClear();
  });

  it("ignores non-admin callers", async () => {
    await postopen({ chat: { id: 5 }, from: { id: 5 } });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("posts the open-in-private card to the channel and confirms", async () => {
    await postopen(adminMsg);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const [chatId, text, opts] = sendMessage.mock.calls[0];
    expect(chatId).toBe("-100123");
    expect(text).toBe(POSTOPEN_TEXT);
    expect(opts.reply_markup.inline_keyboard[0][0]).toEqual({
      text: POSTOPEN_BUTTON_TEXT,
      url: "https://t.me/NbkristQik_bot",
    });
    expect(sendMessage.mock.calls[1][0]).toBe(777);
  });
});
