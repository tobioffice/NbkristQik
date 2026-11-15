import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Message } from "node-telegram-bot-api";

const sendMessage = vi.fn(async () => ({
  message_id: 0,
  ephemeral_message_id: 77,
}));
const editEphemeralMessageText = vi.fn(async (_params: unknown) => true);
const editEphemeralMessageReplyMarkup = vi.fn(async (_params: unknown) => true);

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    api: {
      sendMessage,
      editEphemeralMessageText,
      editEphemeralMessageReplyMarkup,
    },
  },
}));

const {
  ephemeralCommand,
  ephemeralCallback,
  sendEphemeral,
  editEphemeral,
  editEphemeralMarkup,
} = await import("../../src/bot/academics/ephemeral.js");

const target = { receiverUserId: 42, replyToEphemeralId: 55 };
const markup = { inline_keyboard: [] as never[] };

beforeEach(() => {
  vi.clearAllMocks();
  sendMessage.mockResolvedValue({ message_id: 0, ephemeral_message_id: 77 });
});

describe("finding the ephemeral target", () => {
  it("reads an ephemeral command", () => {
    const message = {
      ephemeral_message_id: 55,
      from: { id: 42 },
    } as unknown as Message;

    expect(ephemeralCommand(message)).toEqual(target);
    expect(ephemeralCommand({} as Message)).toBeNull();
  });

  it("reads an ephemeral card from its id", () => {
    expect(ephemeralCallback(77, 42, "cb-1")).toEqual({
      receiverUserId: 42,
      callbackQueryId: "cb-1",
    });
    expect(ephemeralCallback(undefined, 42, "cb-1")).toBeNull();
  });
});

describe("sending an ephemeral message", () => {
  it("replies to the command and keeps the markup", async () => {
    await sendEphemeral(-100, target, "hi", markup);

    expect(sendMessage).toHaveBeenCalledWith({
      chat_id: -100,
      text: "hi",
      parse_mode: "HTML",
      reply_markup: markup,
      reply_parameters: { ephemeral_message_id: 55 },
      ephemeral_message_parameters: { receiver_user_id: 42 },
    });
  });

  it("answers a callback without a chat id or markup", async () => {
    await sendEphemeral(
      -100,
      { receiverUserId: 42, callbackQueryId: "cb-1" },
      "hi",
    );

    expect(sendMessage).toHaveBeenCalledWith({
      text: "hi",
      parse_mode: "HTML",
      ephemeral_message_parameters: { callback_query_id: "cb-1" },
    });
  });

  it("is null when there is nothing to reply to", async () => {
    expect(await sendEphemeral(-100, { receiverUserId: 42 }, "hi")).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("is null when Telegram returns no ephemeral id", async () => {
    sendMessage.mockResolvedValueOnce({ message_id: 0 } as never);

    expect(await sendEphemeral(-100, target, "hi")).toBeNull();
  });
});

describe("editing an ephemeral card", () => {
  it("writes text and buttons", async () => {
    await editEphemeral(-100, target, 77, { text: "hi" }, markup);

    expect(editEphemeralMessageText).toHaveBeenCalledWith({
      chat_id: -100,
      receiver_user_id: 42,
      ephemeral_message_id: 77,
      text: "hi",
      parse_mode: "HTML",
      reply_markup: markup,
    });
  });

  it("writes rich content instead of text", async () => {
    await editEphemeral(-100, target, 77, { rich: "<p>hi</p>" });

    expect(editEphemeralMessageText).toHaveBeenCalledWith({
      chat_id: -100,
      receiver_user_id: 42,
      ephemeral_message_id: 77,
      rich_message: { html: "<p>hi</p>" },
    });
  });

  it("replaces only the buttons", async () => {
    await editEphemeralMarkup(-100, target, 77, markup);

    expect(editEphemeralMessageReplyMarkup).toHaveBeenCalledWith({
      chat_id: -100,
      receiver_user_id: 42,
      ephemeral_message_id: 77,
      reply_markup: markup,
    });
  });
});
