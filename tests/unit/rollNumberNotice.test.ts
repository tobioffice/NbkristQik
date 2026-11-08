import { describe, it, expect, vi } from "vitest";
import {
  createOnTextMock,
  createSendMessageMock,
  replyKeyboard,
  sentMessage,
  type SendMessageOptions,
} from "../mocks/telegram.mock.js";

// Capture the handler the module registers and the messages it sends instead
// of talking to Telegram.
const onText = createOnTextMock();
const sendMessage = createSendMessageMock();
const editMessageText = vi.fn(async () => true);

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    onText,
    on: vi.fn(),
    sendMessage,
    editMessageText,
    editMessageReplyMarkup: vi.fn(async () => true),
    deleteMessage: vi.fn(async () => true),
    answerCallbackQuery: vi.fn(async () => true),
  },
}));
vi.mock("../../src/services/student.service.js", () => ({
  getAttendanceCard: vi.fn(async () => ({ text: "Attendance card" })),
  getMidMarksCard: vi.fn(async () => ({ text: "Mid marks card" })),
  getBunkPlanCard: vi.fn(async () => ({ text: "Bunk plan card" })),
}));
vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn(async () => ({ roll_no: "25KB1A05AR" })),
}));
vi.mock("../../src/db/student.model.js", () => ({ upsertTgUser: vi.fn() }));
vi.mock("../../src/db/registration.model.js", () => ({
  getRegistration: vi.fn(async () => null),
  upsertRegistration: vi.fn(async () => undefined),
  RollAlreadyRegisteredError: class RollAlreadyRegisteredError extends Error {},
}));
vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
}));
vi.mock("../../src/bot/authorization.js", () => ({
  isAuthorizedUser: vi.fn(async () => true),
  rememberStudent: vi.fn(async () => undefined),
}));

await import("../../src/bot/academics/academicHandler.js");

const rollHandler = onText.mock.calls[0][1] as (msg: unknown) => void;

const sendRoll = (text: string) =>
  rollHandler({
    chat: { id: 42, type: "private" },
    from: { id: 42, username: "student", first_name: "Student" },
    text,
    message_id: 7,
  });

const finalCard = () => {
  const call = editMessageText.mock.calls.at(-1);
  if (!call) throw new Error("the card was never edited");
  return call as unknown as [string, SendMessageOptions];
};

describe("roll number O/0 notice", () => {
  it("keeps the correction notice in the placeholder and the final card", async () => {
    sendMessage.mockClear();
    editMessageText.mockClear();

    sendRoll("25KB1AO5AR");

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("<code>Getting your attendance...</code>"),
        expect.anything(),
      ),
    );

    const [, placeholder, placeholderOptions] = sentMessage(sendMessage);
    expect(placeholder).toContain("<code>25KB1A05AR</code>");
    // the tags only render when the message is sent as HTML
    expect(placeholderOptions.parse_mode).toBe("HTML");
    expect(placeholderOptions.reply_to_message_id).toBe(7);

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    const [text, options] = finalCard();
    expect(text).toContain("<code>25KB1A05AR</code>");
    expect(options.parse_mode).toBe("HTML");

    // the card carries its actions, not a dead end
    const buttons = replyKeyboard(options).inline_keyboard.flat();
    expect(buttons.map((button) => button.callback_data)).toEqual(
      expect.arrayContaining([
        "att_25KB1A05AR",
        "mid_25KB1A05AR",
        "bunk_25KB1A05AR",
        "save_25KB1A05AR",
      ]),
    );
    expect(
      buttons.find((button) => button.text === "Leaderboard"),
    ).toBeTruthy();
  });

  it("sends no notice when the roll was typed correctly", async () => {
    sendMessage.mockClear();
    editMessageText.mockClear();

    sendRoll("25KB1A05AR");

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    const [, placeholder] = sentMessage(sendMessage);
    expect(placeholder).not.toContain("Heads up");

    const [text] = finalCard();
    expect(text).not.toContain("Heads up");
    expect(text).not.toContain("<code>25KB1A05AR</code>");
  });

  it("does not send the old menu", async () => {
    sendMessage.mockClear();
    editMessageText.mockClear();

    sendRoll("25KB1A05AR");

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    const texts = sendMessage.mock.calls.map(([, text]) => text);
    expect(texts.join("\n")).not.toContain("What do you want to check?");
  });
});
