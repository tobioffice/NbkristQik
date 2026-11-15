import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCommandMock,
  createSendMessageMock,
  contextFor,
  registeredCommandHandler,
  replyKeyboard,
  sentMessage,
} from "../mocks/telegram.mock.js";

// capture the handler the command module registers instead of talking to
// Telegram, and the messages it sends
const command = createCommandMock();
const sendMessage = createSendMessageMock(3);

vi.mock("../../src/bot/bot.js", () => ({
  bot: { command, api: { sendMessage } },
}));
vi.mock("../../src/services/tracker.js", () => ({ trackMessage: vi.fn() }));

process.env.ADMIN_ID = "777";
process.env.TEST_CHANNEL = "-100123";

await import("../../src/bot/commands/postopen.js");
const { POSTOPEN_TEXT, POSTOPEN_BUTTON_TEXT } =
  await import("../../src/bot/commands/postopen.js");

/** The /postopen handler (admin-only, no arguments). */
const postopen = registeredCommandHandler<(ctx: unknown) => Promise<void>>(
  command,
  "postopen",
);

const adminMsg = { chat: { id: 777 }, from: { id: 777 } };
const ctxFor = (message: typeof adminMsg) =>
  contextFor({ message, match: "", api: { sendMessage } });

describe("/postopen", () => {
  beforeEach(() => {
    sendMessage.mockClear();
  });

  it("ignores non-admin callers", async () => {
    await postopen(ctxFor({ chat: { id: 5 }, from: { id: 5 } }));

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("posts the open-in-private card to the channel and confirms", async () => {
    await postopen(ctxFor(adminMsg));

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const params = sentMessage(sendMessage);
    expect(params.chat_id).toBe("-100123");
    expect(params.text).toBe(POSTOPEN_TEXT);
    expect(replyKeyboard(params).inline_keyboard[0][0]).toEqual({
      text: POSTOPEN_BUTTON_TEXT,
      url: "https://t.me/NbkristQik_bot",
    });
    expect(sendMessage.mock.calls[1][0].chat_id).toBe(777);
  });
});
