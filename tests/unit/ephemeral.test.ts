import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Message } from "node-telegram-bot-api";

const sendMessage = vi.fn(async (_params: unknown) => ({
  message_id: 0,
  ephemeral_message_id: 77,
}));

vi.mock("../../src/bot/bot.js", () => ({
  bot: { api: { sendMessage } },
}));

const { ephemeralCommand, sendEphemeral } =
  await import("../../src/bot/academics/ephemeral.js");

const target = { receiverUserId: 42, replyToEphemeralId: 55 };
const markup = { inline_keyboard: [] as never[] };

beforeEach(() => {
  sendMessage.mockClear();
});

describe("finding an ephemeral command", () => {
  it("reads the sender and the message to reply to", () => {
    const message = {
      ephemeral_message_id: 55,
      from: { id: 42 },
    } as unknown as Message;

    expect(ephemeralCommand(message)).toEqual(target);
    expect(ephemeralCommand({} as Message)).toBeNull();
  });
});

describe("sending the private prompt", () => {
  it("replies to the command with the button", async () => {
    await sendEphemeral(-100, target, "Open it in the bot", markup);

    expect(sendMessage).toHaveBeenCalledWith({
      chat_id: -100,
      text: "Open it in the bot",
      parse_mode: "HTML",
      reply_markup: markup,
      reply_parameters: { ephemeral_message_id: 55 },
      ephemeral_message_parameters: { receiver_user_id: 42 },
    });
  });

  it("works without a keyboard", async () => {
    await sendEphemeral(-100, target, "One line");

    expect(sendMessage).toHaveBeenCalledWith({
      chat_id: -100,
      text: "One line",
      parse_mode: "HTML",
      reply_parameters: { ephemeral_message_id: 55 },
      ephemeral_message_parameters: { receiver_user_id: 42 },
    });
  });
});
