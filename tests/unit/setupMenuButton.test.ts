import { describe, it, expect, vi, afterEach } from "vitest";
import type TelegramBot from "node-telegram-bot-api";
import { setupBot } from "../../src/bot/setup.js";
import { APP_WEBAPP_URL } from "../../src/constants/webapp.js";

type BotCommand = { command: string; description: string };

const setMyCommands = vi.fn<
  (commands: BotCommand[], options?: { scope?: unknown }) => Promise<boolean>
>(async () => true);
const setChatMenuButton = vi.fn<
  (options: { menu_button: string }) => Promise<boolean>
>(async () => true);

const fakeBot = { setMyCommands, setChatMenuButton } as unknown as TelegramBot;

const menuButton = (): {
  type: string;
  text: string;
  web_app: { url: string };
} => JSON.parse(setChatMenuButton.mock.calls[0][0].menu_button);

const original = process.env.LIBRARY_ACCESS;

afterEach(() => {
  if (original === undefined) delete process.env.LIBRARY_ACCESS;
  else process.env.LIBRARY_ACCESS = original;
  setMyCommands.mockClear();
  setChatMenuButton.mockClear();
});

describe("the bot menu button", () => {
  it("opens the app index even while the library is admin-only", async () => {
    process.env.LIBRARY_ACCESS = "admin";

    await setupBot(fakeBot);

    expect(menuButton()).toEqual({
      type: "web_app",
      text: "Open app",
      web_app: { url: APP_WEBAPP_URL },
    });
    // the library command stays gated; only the button is unconditional
    const defaultCommands = setMyCommands.mock.calls[0][0];
    expect(defaultCommands.map((c) => c.command)).not.toContain("library");
  });

  it("still opens the app index once the library is open to all", async () => {
    process.env.LIBRARY_ACCESS = "all";

    await setupBot(fakeBot);

    expect(menuButton().web_app.url).toBe(APP_WEBAPP_URL);
    // and the library command joins the public list
    const defaultCommands = setMyCommands.mock.calls[0][0];
    expect(defaultCommands.map((c) => c.command)).toContain("library");
  });
});
