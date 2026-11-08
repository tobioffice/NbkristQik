import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createOnTextMock,
  createOnMock,
  createSendMessageMock,
  sentMessage,
  type ReplyKeyboard,
  type SendMessageOptions,
} from "../mocks/telegram.mock.js";

// Telegram is captured: no network, and every call the flow makes is visible.
const onText = createOnTextMock();
const on = createOnMock();
const sendMessage = createSendMessageMock();
const editMessageText = vi.fn<
  (
    text: string,
    options: SendMessageOptions & { chat_id?: number; message_id?: number },
  ) => Promise<unknown>
>(async () => true);
const editMessageReplyMarkup = vi.fn<
  (
    markup: ReplyKeyboard,
    options: { chat_id: number; message_id: number },
  ) => Promise<unknown>
>(async () => true);
const deleteMessage = vi.fn<
  (chatId: number, messageId: number) => Promise<boolean>
>(async () => true);
const answerCallbackQuery = vi.fn<
  (
    id: string,
    options?: { text?: string; show_alert?: boolean },
  ) => Promise<unknown>
>(async () => true);

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    onText,
    on,
    sendMessage,
    editMessageText,
    editMessageReplyMarkup,
    deleteMessage,
    answerCallbackQuery,
  },
}));

vi.mock("../../src/services/student.service.js", () => ({
  getAttendanceCard: vi.fn(),
  getMidMarksCard: vi.fn(),
  getBunkPlanCard: vi.fn(),
}));

vi.mock("../../src/db/registration.model.js", () => {
  class RollAlreadyRegisteredError extends Error {
    readonly rollNo: string;
    readonly userId: string;
    constructor(rollNo: string, userId: string) {
      super(`Roll ${rollNo} is already registered to another account.`);
      this.name = "RollAlreadyRegisteredError";
      this.rollNo = rollNo;
      this.userId = userId;
    }
  }
  return {
    getRegistration: vi.fn(),
    upsertRegistration: vi.fn(),
    RollAlreadyRegisteredError,
  };
});

vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn(async () => ({ roll_no: "25KB1A05AR" })),
}));
vi.mock("../../src/db/student.model.js", () => ({ upsertTgUser: vi.fn() }));
vi.mock("../../src/services/tracker.js", () => ({ trackActivity: vi.fn() }));
vi.mock("../../src/bot/authorization.js", () => ({
  isAuthorizedUser: vi.fn(async () => true),
  rememberStudent: vi.fn(async () => undefined),
}));
vi.mock("../../src/middleware/security.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/middleware/security.js")>();
  return { ...actual, botSecurityHandler: vi.fn(async () => true) };
});

await import("../../src/bot/academics/academicHandler.js");

const { getAttendanceCard, getMidMarksCard, getBunkPlanCard } =
  await import("../../src/services/student.service.js");
const { getRegistration, upsertRegistration, RollAlreadyRegisteredError } =
  await import("../../src/db/registration.model.js");
const { trackActivity } = await import("../../src/services/tracker.js");
const { upsertTgUser } = await import("../../src/db/student.model.js");
const { getStudentCached } = await import("../../src/services/redis/utils.js");
const { WEBAPP_URL } = await import("../../src/constants/webapp.js");

const rollHandler = onText.mock.calls[0][1] as (msg: unknown) => void;
const callbackHandler = on.mock.calls.find(
  ([event]) => event === "callback_query",
)?.[1] as (query: unknown) => Promise<void>;

const sendRoll = (userId: number, text = "25KB1A05AR", chatType = "private") =>
  rollHandler({
    chat: { id: userId, type: chatType },
    from: { id: userId, username: "student", first_name: "Student" },
    text,
    message_id: 7,
  });

const tap = (
  userId: number,
  data: string,
  messageId = 9,
  chatType = "private",
) =>
  callbackHandler({
    id: `callback-${userId}-${data}`,
    from: { id: userId, username: "student", first_name: "Student" },
    data,
    message: {
      chat: { id: userId, type: chatType },
      message_id: messageId,
      text: "card",
    },
  });

const buttonsIn = (markup: ReplyKeyboard | undefined) =>
  markup?.inline_keyboard.flat() ?? [];

const callbackData = (markup: ReplyKeyboard | undefined) =>
  buttonsIn(markup).map((button) => button.callback_data);

const lastEdit = () => {
  const call = editMessageText.mock.calls.at(-1);
  if (!call) throw new Error("the card was never edited");
  return call;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAttendanceCard).mockReset();
  vi.mocked(getMidMarksCard).mockReset();
  vi.mocked(getBunkPlanCard).mockReset();
  vi.mocked(getAttendanceCard).mockResolvedValue({
    text: "Attendance for <b>25KB1A05AR</b>",
  });
  vi.mocked(getMidMarksCard).mockResolvedValue({
    text: "Mid marks for <b>25KB1A05AR</b>",
  });
  vi.mocked(getBunkPlanCard).mockResolvedValue({
    text: "Bunk plan for <b>25KB1A05AR</b>",
  });

  vi.mocked(getRegistration).mockReset();
  vi.mocked(getRegistration).mockResolvedValue(null);
  vi.mocked(upsertRegistration).mockReset();
  vi.mocked(upsertRegistration).mockResolvedValue(undefined);
});

describe("attendance card", () => {
  it("answers a typed roll with the attendance card instead of a menu", async () => {
    sendRoll(201);

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    expect(getAttendanceCard).toHaveBeenCalledWith("25KB1A05AR");

    const [, placeholder, placeholderOptions] = sentMessage(sendMessage);
    expect(placeholder).toContain("Getting your attendance...");
    expect(placeholderOptions.parse_mode).toBe("HTML");
    expect(placeholderOptions.reply_to_message_id).toBe(7);
    expect(callbackData(placeholderOptions.reply_markup)).toContain(
      "att_25KB1A05AR",
    );

    const [text, options] = lastEdit();
    expect(text).toContain("Attendance for");
    expect(options.message_id).toBe(1);

    const sentText = sendMessage.mock.calls.map(([, body]) => body).join("\n");
    expect(sentText).not.toContain("What do you want to check?");
  });

  it("keeps Attendance, Mid marks, Bunk, Save and Leaderboard on the card", async () => {
    sendRoll(202);

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    const [, options] = lastEdit();
    expect(callbackData(options.reply_markup)).toEqual(
      expect.arrayContaining([
        "att_25KB1A05AR",
        "mid_25KB1A05AR",
        "bunk_25KB1A05AR",
        "save_25KB1A05AR",
      ]),
    );

    const leaderboard = buttonsIn(options.reply_markup).find(
      (button) => button.text === "Leaderboard",
    );
    // private chat: the leaderboard opens inside Telegram
    expect(leaderboard?.web_app).toEqual({ url: WEBAPP_URL });
  });

  it.each(["group", "supergroup"])(
    "answers a roll in a %s with a private link, never the card",
    async (chatType) => {
      sendRoll(203, "25KB1A05AR", chatType);

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());

      const [chatId, text, options] = sentMessage(sendMessage);
      expect(chatId).toBe(203);
      expect(text).toBe(
        "Your attendance is private. Tap to open it in the bot.",
      );
      // the roll travels in the button's link, never in the visible text
      expect(text).not.toContain("25KB1A05AR");
      expect(options.reply_to_message_id).toBe(7);

      const buttons = buttonsIn(options.reply_markup);
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toEqual({
        text: "Open attendance",
        url: "https://t.me/NbkristQik_bot?start=att_25KB1A05AR",
      });

      // no portal read, no card, no last-lookup and no roll_lookup event
      expect(getAttendanceCard).not.toHaveBeenCalled();
      expect(editMessageText).not.toHaveBeenCalled();
      expect(trackActivity).not.toHaveBeenCalled();
      expect(getStudentCached).not.toHaveBeenCalled();
      expect(upsertTgUser).not.toHaveBeenCalled();
    },
  );

  it("keeps a plain leaderboard link when an old group card is tapped", async () => {
    await tap(210, "att_25KB1A05AR", 9, "group");

    const [, options] = lastEdit();
    const leaderboard = buttonsIn(options.reply_markup).find(
      (button) => button.text === "Leaderboard",
    );
    expect(leaderboard?.url).toBe(WEBAPP_URL);
    expect(leaderboard?.web_app).toBeUndefined();
  });

  it("edits the tapped card in place and never deletes it", async () => {
    await tap(204, "mid_25KB1A05AR", 9);

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(editMessageText).toHaveBeenCalledTimes(2);

    const [placeholderText, placeholderOptions] = editMessageText.mock.calls[0];
    expect(placeholderText).toContain("Getting your mid marks");
    expect(placeholderOptions.message_id).toBe(9);

    const [finalText, finalOptions] = editMessageText.mock.calls[1];
    expect(finalText).toContain("Mid marks for");
    expect(finalOptions.message_id).toBe(9);
    expect(callbackData(finalOptions.reply_markup)).toEqual(
      expect.arrayContaining([
        "att_25KB1A05AR",
        "mid_25KB1A05AR",
        "bunk_25KB1A05AR",
        "save_25KB1A05AR",
      ]),
    );
    expect(answerCallbackQuery).toHaveBeenCalled();
  });

  it("saves the roll and hides the Save button", async () => {
    await tap(205, "save_25KB1A05AR", 9);

    expect(upsertRegistration).toHaveBeenCalledWith("205", "25KB1A05AR", null);

    const answer = answerCallbackQuery.mock.calls.at(-1);
    expect(answer?.[1]?.text).toContain("Saved");

    expect(editMessageReplyMarkup).toHaveBeenCalledTimes(1);
    const [markup, options] = editMessageReplyMarkup.mock.calls[0];
    expect(options).toEqual({ chat_id: 205, message_id: 9 });
    expect(callbackData(markup)).not.toContain("save_25KB1A05AR");
    expect(callbackData(markup)).toEqual(
      expect.arrayContaining(["att_25KB1A05AR", "mid_25KB1A05AR"]),
    );
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it("answers 'Saved already' on a second tap and does not write again", async () => {
    vi.mocked(getRegistration).mockResolvedValue({
      userId: "206",
      roll_no: "25KB1A05AR",
      display_name: null,
      registered_at: "2026-01-01",
      updated_at: "2026-01-01",
    });

    await tap(206, "save_25KB1A05AR", 9);

    expect(upsertRegistration).not.toHaveBeenCalled();
    expect(answerCallbackQuery.mock.calls.at(-1)?.[1]?.text).toBe(
      "Saved already",
    );
  });

  it("answers with the web 409 copy when another account holds the roll", async () => {
    vi.mocked(upsertRegistration).mockRejectedValue(
      new RollAlreadyRegisteredError("25KB1A05AR", "someone-else"),
    );

    await tap(207, "save_25KB1A05AR", 9);

    const answer = answerCallbackQuery.mock.calls.at(-1);
    expect(answer?.[1]?.text).toContain(
      "already saved to another Telegram account",
    );
    expect(answer?.[1]?.text).not.toContain("someone-else");
    // the card keeps its Save button: nothing was saved
    expect(editMessageReplyMarkup).not.toHaveBeenCalled();
  });

  it("makes suggested rolls tappable and keeps the card actions", async () => {
    vi.mocked(getAttendanceCard).mockResolvedValueOnce({
      text: "<code>25KB1A05AX</code> isn't in the college records yet.",
      markup: {
        inline_keyboard: [
          [{ text: "25KB1A05AR", callback_data: "att_25KB1A05AR" }],
        ],
      },
    });

    sendRoll(208, "25KB1A05AX");

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    const [, options] = lastEdit();
    expect(callbackData(options.reply_markup)).toEqual(
      expect.arrayContaining([
        "att_25KB1A05AX",
        "att_25KB1A05AR",
        "save_25KB1A05AX",
      ]),
    );
  });

  it("rejects a mutated callback without touching the card", async () => {
    await tap(209, "att_not-a-roll", 9);

    const answer = answerCallbackQuery.mock.calls.at(-1);
    expect(answer?.[1]?.text).toContain("doesn't look right");
    expect(editMessageText).not.toHaveBeenCalled();
    expect(editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
  });
});
