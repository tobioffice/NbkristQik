import { describe, it, expect, vi } from "vitest";
import {
  createCommandMock,
  createSendMessageMock,
  contextFor,
  registeredCommandHandler,
  replyKeyboard,
  sentMessage,
} from "../mocks/telegram.mock.js";

// Capture the handler the command module registers and the messages it sends
// instead of talking to Telegram.
const command = createCommandMock();
const sendMessage = createSendMessageMock();

vi.mock("../../src/bot/bot.js", () => ({
  bot: { command, api: { sendMessage } },
}));
vi.mock("../../src/services/tracker.js", () => ({ trackMessage: vi.fn() }));

const { appPageButton } = await import("../../src/bot/appButton.js");
const { REGISTER_WEBAPP_URL, appDirectLink } =
  await import("../../src/constants/webapp.js");
await import("../../src/bot/commands/register.js");

const register = registeredCommandHandler<(ctx: unknown) => unknown>(
  command,
  "register",
);

const message = (chatType: "private" | "group" | "supergroup") => ({
  chat: { id: chatType === "private" ? 42 : -100123, type: chatType },
  from: { id: 42, first_name: "Student" },
  text: "/register",
});

const ctxFor = (msg: ReturnType<typeof message>) =>
  contextFor({ message: msg, match: "", api: { sendMessage } });

const sentButton = () =>
  replyKeyboard(sentMessage(sendMessage)).inline_keyboard[0][0];

describe("appPageButton", () => {
  it("is a web_app button in a private chat", () => {
    expect(appPageButton("Open", "profile", true)).toEqual({
      text: "Open",
      web_app: { url: REGISTER_WEBAPP_URL },
      style: "primary",
    });
  });

  it("is a direct link in a group, where Telegram rejects web_app", () => {
    expect(appPageButton("Open", "profile", false)).toEqual({
      text: "Open",
      url: appDirectLink("profile"),
      style: "primary",
    });
  });
});

describe("/register", () => {
  it("answers in a private chat with the web_app button", () => {
    sendMessage.mockClear();

    register(ctxFor(message("private")));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sentButton()).toEqual({
      text: "👤 Open registration",
      web_app: { url: REGISTER_WEBAPP_URL },
      style: "primary",
    });
  });

  it("answers in a group with a direct link, never a web_app button", () => {
    sendMessage.mockClear();

    register(ctxFor(message("group")));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sentButton()).toEqual({
      text: "👤 Open registration",
      url: appDirectLink("profile"),
      style: "primary",
    });
    expect(JSON.stringify(sentButton())).not.toContain("web_app");
  });

  it("swallows a rejected send instead of leaving an unhandled rejection", async () => {
    sendMessage.mockClear();
    sendMessage.mockRejectedValueOnce(
      new Error("Bad Request: BUTTON_TYPE_INVALID"),
    );

    expect(() => register(ctxFor(message("supergroup")))).not.toThrow();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    // let the caught rejection settle; vitest fails on unhandled rejections
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
