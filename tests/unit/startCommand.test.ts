import { describe, it, expect, vi } from "vitest";
import {
  createOnTextMock,
  createSendMessageMock,
  registeredTextHandler,
  sentMessage,
} from "../mocks/telegram.mock.js";

// Capture the /start handler and the messages it sends instead of talking to
// Telegram.
const onText = createOnTextMock();
const sendMessage = createSendMessageMock();
const sendLibraryEntry = vi.fn();

vi.mock("../../src/bot/bot.js", () => ({ bot: { onText, sendMessage } }));
vi.mock("../../src/services/tracker.js", () => ({ trackMessage: vi.fn() }));
vi.mock("../../src/bot/commands/library.js", () => ({ sendLibraryEntry }));

await import("../../src/bot/commands/start.js");

const start = registeredTextHandler<(msg: unknown) => void>(onText, "/start");

const message = (text: string) => ({
  chat: { id: 42, type: "private" },
  from: { id: 42, first_name: "Student" },
  text,
});

describe("/start", () => {
  it("sends the library payload to the library entry", () => {
    sendLibraryEntry.mockClear();
    sendMessage.mockClear();

    start(message("/start library"));

    expect(sendLibraryEntry).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("treats the retired 'unlocked' payload as a plain welcome", () => {
    sendLibraryEntry.mockClear();
    sendMessage.mockClear();

    start(message("/start unlocked"));

    expect(sendLibraryEntry).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, text] = sentMessage(sendMessage);
    expect(text).toContain("welcome in");
  });

  it("welcomes a plain /start", () => {
    sendLibraryEntry.mockClear();
    sendMessage.mockClear();

    start(message("/start"));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("welcome in");
  });
});
