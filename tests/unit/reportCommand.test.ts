import { describe, it, expect, vi } from "vitest";
import {
  createCommandMock,
  createSendMessageMock,
  contextFor,
  registeredCommandHandler,
  sentMessage,
} from "../mocks/telegram.mock.js";

// capture the handler the command module registers instead of talking to
// Telegram, and the replies it sends
const command = createCommandMock();
const sendMessage = createSendMessageMock();

vi.mock("../../src/bot/bot.js", () => ({
  bot: { command, api: { sendMessage } },
}));
vi.mock("../../src/db/db.js", () => ({ turso: { execute: vi.fn() } }));
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({ set: vi.fn(async () => "OK") })),
}));
vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
  trackMessage: vi.fn(),
}));

await import("../../src/bot/commands/report.js");
const { REPORT_LIST_WEBAPP_URL, REPORT_WEBAPP_URL, appDirectLink } =
  await import("../../src/constants/webapp.js");

/** The "/report" handler; a bare command opens the form. */
const report = registeredCommandHandler<(ctx: unknown) => Promise<void>>(
  command,
  "report",
);

const keyboardFor = async (chatType: string) => {
  sendMessage.mockClear();
  await report(
    contextFor({
      message: { chat: { id: 42, type: chatType }, from: { id: 42 } },
      match: "",
      api: { sendMessage },
    }),
  );
  return sentMessage(sendMessage).reply_markup;
};

describe("/report form message", () => {
  it("offers both the form and the reporter's own list", async () => {
    const privateKeyboard = await keyboardFor("private");
    const json = JSON.stringify(privateKeyboard);

    expect(json).toContain(REPORT_WEBAPP_URL);
    expect(json).toContain(REPORT_LIST_WEBAPP_URL);
    expect(privateKeyboard?.inline_keyboard).toHaveLength(2);
  });

  it("lists the reports view as a second button", async () => {
    const keyboard = (await keyboardFor("private"))?.inline_keyboard;

    expect(keyboard?.[0][0]).toEqual({
      text: "🐞 Report an issue",
      web_app: { url: REPORT_WEBAPP_URL },
      style: "primary",
    });
    expect(keyboard?.[1][0]).toEqual({
      text: "🗂 My reports",
      web_app: { url: REPORT_LIST_WEBAPP_URL },
    });
    expect(REPORT_LIST_WEBAPP_URL.endsWith("?page=issues")).toBe(true);
  });

  it("falls back to direct links outside a private chat (web_app is private-only)", async () => {
    const keyboard = (await keyboardFor("supergroup"))?.inline_keyboard;

    expect(keyboard?.[0][0]).toEqual({
      text: "🐞 Report an issue",
      url: appDirectLink("issues/new"),
      style: "primary",
    });
    expect(keyboard?.[1][0]).toEqual({
      text: "🗂 My reports",
      url: appDirectLink("issues"),
    });
    expect(JSON.stringify(keyboard)).not.toContain("web_app");
  });
});
