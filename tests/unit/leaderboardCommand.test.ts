import { describe, it, expect, vi } from "vitest";
import {
  createCommandMock,
  createSendMessageMock,
  contextFor,
  registeredCommandHandler,
  sentMessage,
} from "../mocks/telegram.mock.js";

const command = createCommandMock();
const sendMessage = createSendMessageMock();

vi.mock("../../src/bot/bot.js", () => ({
  bot: { command, api: { sendMessage } },
}));
vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
  trackMessage: vi.fn(),
}));
vi.mock("../../src/middleware/security.js", () => ({
  botSecurityHandler: vi.fn(async () => true),
}));

const { LEADERBOARD_WEBAPP_URL, appDirectLink } =
  await import("../../src/constants/webapp.js");

await import("../../src/bot/commands/leaderboard.js");

const handler = registeredCommandHandler<(ctx: unknown) => unknown>(
  command,
  "leaderboard",
);

const run = async (chatType: string) => {
  sendMessage.mockClear();
  const message = {
    chat: { id: 42, type: chatType },
    from: { id: 42 },
    message_id: 9,
  };
  await handler(contextFor({ message, match: "", api: { sendMessage } }));
  return sentMessage(sendMessage);
};

describe("/leaderboard", () => {
  it("routes a private chat to the app", async () => {
    const params = await run("private");

    expect(params.chat_id).toBe(42);
    expect(params.text).toContain("Attendance register");
    expect(params.text).not.toContain("ASHA");
    expect(params.reply_markup?.inline_keyboard[0][0]).toEqual({
      text: "Open the register",
      web_app: { url: LEADERBOARD_WEBAPP_URL },
      style: "primary",
    });
    expect(params.reply_parameters?.message_id).toBe(9);
  });

  it("uses a direct link in a group, never a web_app button", async () => {
    const params = await run("supergroup");

    expect(params.reply_markup?.inline_keyboard[0][0]).toEqual({
      text: "Open the register",
      url: appDirectLink("rank"),
      style: "primary",
    });
    expect(JSON.stringify(params.reply_markup)).not.toContain("web_app");
  });
});
