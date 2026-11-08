import { describe, it, expect, vi, beforeEach } from "vitest";
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
const deleteMessage = vi.fn<
  (chatId: number | string, messageId: number) => Promise<boolean>
>(async () => true);
const sendLibraryEntry = vi.fn(async () => undefined);
const trackMessage = vi.fn();
const rememberStudent = vi.fn(async () => undefined);

interface DeepLinkOptions {
  replyToMessageId?: number;
  notice?: string;
}

const sendAttendanceOrMidMarks = vi.fn<
  (
    msg: unknown,
    roll: string,
    signal: string,
    options: DeepLinkOptions,
  ) => Promise<void>
>(async () => undefined);

const isAuthorizedUser = vi.fn<
  (request: {
    userId: number;
    chatId: number;
    joinPromptChatId?: number;
  }) => Promise<boolean>
>(async () => true);

vi.mock("../../src/bot/bot.js", () => ({
  bot: { onText, sendMessage, deleteMessage },
}));
vi.mock("../../src/services/tracker.js", () => ({ trackMessage }));
vi.mock("../../src/bot/commands/library.js", () => ({ sendLibraryEntry }));
vi.mock("../../src/bot/academics/studentActions.js", () => ({
  sendAttendanceOrMidMarks,
}));
vi.mock("../../src/bot/authorization.js", () => ({
  isAuthorizedUser,
  rememberStudent,
}));
vi.mock("../../src/middleware/security.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/middleware/security.js")>();
  return { ...actual, botSecurityHandler: vi.fn(async () => true) };
});

const { rememberGroupPrompt } =
  await import("../../src/bot/academics/groupPrompt.js");

await import("../../src/bot/commands/start.js");

const start = registeredTextHandler<(msg: unknown) => Promise<unknown> | void>(
  onText,
  "/start",
);

const message = (text: string, chatType = "private", messageId = 11) => ({
  chat: { id: 42, type: chatType },
  from: { id: 42, first_name: "Student" },
  text,
  message_id: messageId,
});

beforeEach(() => {
  vi.clearAllMocks();
  isAuthorizedUser.mockResolvedValue(true);
});

describe("/start", () => {
  it("sends the library payload to the library entry", () => {
    sendLibraryEntry.mockClear();
    sendMessage.mockClear();

    start(message("/start library"));

    expect(sendLibraryEntry).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendAttendanceOrMidMarks).not.toHaveBeenCalled();
  });

  it("treats an unknown payload as a plain welcome", () => {
    sendLibraryEntry.mockClear();
    sendMessage.mockClear();

    start(message("/start campaign"));

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

describe("/start att_<roll>", () => {
  it("answers the attendance card here in private", async () => {
    await start(message("/start att_25KB1A05AR"));

    expect(sendAttendanceOrMidMarks).toHaveBeenCalledTimes(1);
    const [, roll, signal, options] = sendAttendanceOrMidMarks.mock.calls[0];
    expect(roll).toBe("25KB1A05AR");
    expect(signal).toBe("att");
    expect(options.replyToMessageId).toBe(11);
    expect(trackMessage).toHaveBeenCalledWith(
      expect.anything(),
      "roll_lookup",
      "25KB1A05AR",
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not answer a blocked student", async () => {
    isAuthorizedUser.mockResolvedValueOnce(false);

    await start(message("/start att_25KB1A05AR"));

    expect(sendAttendanceOrMidMarks).not.toHaveBeenCalled();
  });

  it("never answers an attendance link in a group", async () => {
    await start(message("/start att_25KB1A05AR", "group"));

    expect(sendAttendanceOrMidMarks).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, text] = sentMessage(sendMessage);
    expect(text).toContain("welcome in");
  });

  it("reads a payload O as zero, with the notice", async () => {
    await start(message("/start att_25KB1A05OR"));

    const [, roll, , options] = sendAttendanceOrMidMarks.mock.calls[0];
    expect(roll).toBe("25KB1A050R");
    expect(options.notice).toContain("read that O as 0");
  });

  it("clears the group prompt and the roll message once the student is in the bot", async () => {
    rememberGroupPrompt(42, "25KB1A05AR", {
      chatId: -100200,
      messageId: 77,
      sourceMessageId: 76,
    });

    await start(message("/start att_25KB1A05AR"));

    await vi.waitFor(() =>
      expect(deleteMessage).toHaveBeenCalledWith(-100200, 77),
    );
    expect(deleteMessage).toHaveBeenCalledWith(-100200, 76);
    // the room is clean, the lookup still happens
    expect(sendAttendanceOrMidMarks).toHaveBeenCalledTimes(1);
  });

  it("clears the prompt only once when the link is opened twice", async () => {
    rememberGroupPrompt(42, "25KB1A05AR", {
      chatId: -100201,
      messageId: 78,
      sourceMessageId: 77,
    });

    await start(message("/start att_25KB1A05AR"));
    await vi.waitFor(() =>
      expect(deleteMessage).toHaveBeenCalledWith(-100201, 78),
    );

    await start(message("/start att_25KB1A05AR"));
    expect(deleteMessage).toHaveBeenCalledTimes(2);
  });

  it("still answers when the prompt is already gone", async () => {
    deleteMessage.mockRejectedValueOnce(
      new Error("message to delete not found"),
    );
    rememberGroupPrompt(42, "25KB1A05AR", {
      chatId: -100202,
      messageId: 79,
      sourceMessageId: 78,
    });

    await start(message("/start att_25KB1A05AR"));

    await vi.waitFor(() => expect(deleteMessage).toHaveBeenCalledTimes(2));
    expect(sendAttendanceOrMidMarks).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("falls through to the welcome for a malformed roll", async () => {
    await start(message("/start att_not-a-roll"));

    expect(sendAttendanceOrMidMarks).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, text] = sentMessage(sendMessage);
    expect(text).toContain("welcome in");
  });
});
