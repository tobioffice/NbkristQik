import { describe, it, expect, vi } from "vitest";
import {
  createOnTextMock,
  createSendMessageMock,
  registeredTextHandler,
  replyKeyboard,
  sentMessage,
} from "../mocks/telegram.mock.js";

// Capture the handler the command module registers and the messages it sends
// instead of talking to Telegram.
const onText = createOnTextMock();
const sendMessage = createSendMessageMock();

vi.mock("../../src/bot/bot.js", () => ({ bot: { onText, sendMessage } }));
vi.mock("../../src/services/tracker.js", () => ({ trackMessage: vi.fn() }));

const { appPageButton } = await import("../../src/bot/commands/register.js");
const { REGISTER_WEBAPP_URL } = await import("../../src/constants/webapp.js");

const register = registeredTextHandler<(msg: unknown) => void>(
  onText,
  "/register",
);

const message = (chatType: "private" | "group" | "supergroup") => ({
  chat: { id: chatType === "private" ? 42 : -100123, type: chatType },
  from: { id: 42, first_name: "Student" },
  text: "/register",
});

const sentButton = () =>
  replyKeyboard(sentMessage(sendMessage)[2]).inline_keyboard[0][0];

describe("appPageButton", () => {
  it("is a web_app button in a private chat", () => {
    expect(appPageButton("Open", "https://example.test/app", true)).toEqual({
      text: "Open",
      web_app: { url: "https://example.test/app" },
    });
  });

  it("is a plain link in a group, where Telegram rejects web_app", () => {
    expect(appPageButton("Open", "https://example.test/app", false)).toEqual({
      text: "Open",
      url: "https://example.test/app",
    });
  });
});

describe("/register", () => {
  it("answers in a private chat with the web_app button", () => {
    sendMessage.mockClear();

    register(message("private"));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sentButton()).toEqual({
      text: "👤 Open registration",
      web_app: { url: REGISTER_WEBAPP_URL },
    });
  });

  it("answers in a group with a plain link, never a web_app button", () => {
    sendMessage.mockClear();

    register(message("group"));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sentButton()).toEqual({
      text: "👤 Open registration",
      url: REGISTER_WEBAPP_URL,
    });
    expect(JSON.stringify(sentButton())).not.toContain("web_app");
  });

  it("swallows a rejected send instead of leaving an unhandled rejection", async () => {
    sendMessage.mockClear();
    sendMessage.mockRejectedValueOnce(
      new Error("Bad Request: BUTTON_TYPE_INVALID"),
    );

    expect(() => register(message("supergroup"))).not.toThrow();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    // let the caught rejection settle; vitest fails on unhandled rejections
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
