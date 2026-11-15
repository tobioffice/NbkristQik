import { describe, it, expect, vi } from "vitest";
import {
  createHearsMock,
  createSendMessageMock,
  contextFor,
  firstHearsHandler,
  replyKeyboard,
  sentMessage,
  type ReplyKeyboard,
} from "../mocks/telegram.mock.js";

// Capture the handler the module registers and the messages it sends instead
// of talking to Telegram.
const hears = createHearsMock();
const sendMessage = createSendMessageMock();
const editMessageText = vi.fn<
  (params: {
    chat_id: number | string;
    message_id: number;
    text: string;
    parse_mode?: string;
    reply_markup?: ReplyKeyboard;
  }) => Promise<unknown>
>(async () => true);

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    command: vi.fn(),
    hears,
    on: vi.fn(),
    api: {
      sendMessage,
      editMessageText,
      editMessageReplyMarkup: vi.fn(async () => true),
      deleteMessage: vi.fn(async () => true),
      answerCallbackQuery: vi.fn(async () => true),
    },
  },
}));
vi.mock("../../src/services/student.service.js", () => ({
  getAttendanceCard: vi.fn(async () => ({ text: "Attendance card" })),
  getMidMarksCard: vi.fn(async () => ({ text: "Mid marks card" })),
  getBunkPlanCard: vi.fn(async () => ({ text: "Bunk plan card" })),
}));

vi.mock("../../src/services/verification/otp.js", () => ({
  isLookupBlockedForViewer: vi.fn(async () => false),
  isRegistrationBlockedFor: vi.fn(async () => false),
  getVerificationState: vi.fn(async () => ({
    verified: false,
    roll: null,
    email: null,
    blocked: false,
  })),
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

const rollHandler = firstHearsHandler<(ctx: unknown) => void>(hears);

const sendRoll = (text: string) =>
  rollHandler(
    contextFor({
      message: {
        chat: { id: 42, type: "private" },
        from: { id: 42, username: "student", first_name: "Student" },
        text,
        message_id: 7,
      },
      api: { sendMessage },
    }),
  );

const finalCard = () => {
  const call = editMessageText.mock.calls.at(-1);
  if (!call) throw new Error("the card was never edited");
  return call[0] as {
    text: string;
    parse_mode?: string;
    reply_markup?: { inline_keyboard: { text: string }[][] };
  };
};

describe("roll number O/0 notice", () => {
  it("keeps the correction notice in the placeholder and the final card", async () => {
    sendMessage.mockClear();
    editMessageText.mockClear();

    sendRoll("25KB1AO5AR");

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(
            "<code>Getting your attendance...</code>",
          ),
        }),
      ),
    );

    const placeholder = sentMessage(sendMessage);
    expect(placeholder.text).toContain("<code>25KB1A05AR</code>");
    // the tags only render when the message is sent as HTML
    expect(placeholder.parse_mode).toBe("HTML");
    expect(placeholder.reply_parameters?.message_id).toBe(7);

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    const card = finalCard();
    expect(card.text).toContain("<code>25KB1A05AR</code>");
    expect(card.parse_mode).toBe("HTML");

    // the card carries its actions, not a dead end
    const buttons = replyKeyboard(card).inline_keyboard.flat();
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

    expect(sentMessage(sendMessage).text).not.toContain("Heads up");

    expect(finalCard().text).not.toContain("Heads up");
    expect(finalCard().text).not.toContain("<code>25KB1A05AR</code>");
  });

  it("does not send the old menu", async () => {
    sendMessage.mockClear();
    editMessageText.mockClear();

    sendRoll("25KB1A05AR");

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    const texts = sendMessage.mock.calls.map(([params]) => params.text);
    expect(texts.join("\n")).not.toContain("What do you want to check?");
  });
});
