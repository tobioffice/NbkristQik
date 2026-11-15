import { describe, it, expect, vi, afterEach } from "vitest";
import type {
  MenuButton,
  SetChatMenuButtonParams,
  SetMyCommandsParams,
} from "node-telegram-bot-api";
import { setupBot } from "../../src/bot/setup.js";
import { APP_WEBAPP_URL } from "../../src/constants/webapp.js";

const setMyCommands = vi.fn<(params: SetMyCommandsParams) => Promise<boolean>>(
  async () => true,
);
const setChatMenuButton = vi.fn<
  (params: SetChatMenuButtonParams) => Promise<boolean>
>(async () => true);

const fakeApi = { setMyCommands, setChatMenuButton };

const menuButton = (): MenuButton | undefined =>
  setChatMenuButton.mock.calls[0][0].menu_button;

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

    await setupBot(fakeApi);

    expect(menuButton()).toEqual({
      type: "web_app",
      text: "Open app",
      web_app: { url: APP_WEBAPP_URL },
    });
    // the library command stays gated; only the button is unconditional
    const defaultCommands = setMyCommands.mock.calls[0][0].commands;
    expect(defaultCommands.map((c) => c.command)).not.toContain("library");
  });

  it("still opens the app index once the library is open to all", async () => {
    process.env.LIBRARY_ACCESS = "all";

    await setupBot(fakeApi);

    expect(menuButton()).toMatchObject({
      type: "web_app",
      web_app: { url: APP_WEBAPP_URL },
    });
    // and the library command joins the public list
    const defaultCommands = setMyCommands.mock.calls[0][0].commands;
    expect(defaultCommands.map((c) => c.command)).toContain("library");
  });

  it("marks the private lookups ephemeral in groups only", async () => {
    process.env.LIBRARY_ACCESS = "all";

    await setupBot(fakeApi);

    const group = setMyCommands.mock.calls.find(
      ([params]) => params.scope?.type === "all_group_chats",
    );
    expect(group).toBeDefined();

    const commands = group?.[0].commands ?? [];
    expect(
      commands
        .filter((command) => command.is_ephemeral)
        .map((command) => command.command),
    ).toEqual(["attendance", "midmarks", "bunk"]);

    // a public command stays visible to the room
    expect(
      commands.find((command) => command.command === "leaderboard")
        ?.is_ephemeral,
    ).toBeUndefined();

    // the default (private) list is untouched
    expect(
      setMyCommands.mock.calls[0][0].commands.some(
        (command) => command.is_ephemeral,
      ),
    ).toBe(false);
  });
});
