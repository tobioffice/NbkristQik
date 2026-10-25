import { describe, it, expect, vi } from "vitest";

// capture the handlers the command module registers instead of talking to
// Telegram, and the replies it sends
const onText = vi.fn();
const sendMessage = vi.fn(async () => ({ message_id: 1 }));

vi.mock("../../src/bot/bot.js", () => ({ bot: { onText, sendMessage } }));
vi.mock("../../src/db/db.js", () => ({ turso: { execute: vi.fn() } }));
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({ set: vi.fn(async () => "OK") })),
}));
vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
  trackMessage: vi.fn(),
}));

await import("../../src/bot/commands/report.js");
const { REPORT_LIST_WEBAPP_URL, REPORT_WEBAPP_URL } =
  await import("../../src/constants/webapp.js");

/** The bare "/report" handler (the other one requires a message). */
const bareReport = onText.mock.calls.find(([pattern]: [RegExp]) =>
  pattern.test("/report"),
)?.[1] as (msg: unknown) => void;

const keyboardFor = (chatType: string) => {
  sendMessage.mockClear();
  bareReport({ chat: { id: 42, type: chatType }, from: { id: 42 } });
  return JSON.stringify(sendMessage.mock.calls[0][2]);
};

describe("/report form message", () => {
  it("offers both the form and the reporter's own list", () => {
    expect(bareReport).toBeTypeOf("function");

    const privateKeyboard = keyboardFor("private");
    expect(privateKeyboard).toContain(REPORT_WEBAPP_URL);
    expect(privateKeyboard).toContain(REPORT_LIST_WEBAPP_URL);
    expect(
      JSON.parse(privateKeyboard).reply_markup.inline_keyboard,
    ).toHaveLength(2);
  });

  it("lists the reports view as a second button", () => {
    const keyboard = JSON.parse(keyboardFor("private")).reply_markup
      .inline_keyboard;

    expect(keyboard[0][0]).toEqual({
      text: "🐞 Report an issue",
      web_app: { url: REPORT_WEBAPP_URL },
    });
    expect(keyboard[1][0]).toEqual({
      text: "🗂 My reports",
      web_app: { url: REPORT_LIST_WEBAPP_URL },
    });
    expect(REPORT_LIST_WEBAPP_URL.endsWith("#/issues/reports")).toBe(true);
  });

  it("falls back to plain links outside a private chat (web_app is private-only)", () => {
    const keyboard = JSON.parse(keyboardFor("supergroup")).reply_markup
      .inline_keyboard;

    expect(keyboard[1][0]).toEqual({
      text: "🗂 My reports",
      url: REPORT_LIST_WEBAPP_URL,
    });
    expect(JSON.stringify(keyboard)).not.toContain("web_app");
  });
});
