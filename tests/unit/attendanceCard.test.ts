import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createHearsMock,
  createOnMock,
  createSendMessageMock,
  contextFor,
  firstHearsHandler,
  registeredEventHandler,
  sentMessage,
  type ReplyKeyboard,
} from "../mocks/telegram.mock.js";

// Telegram is captured: no network, and every call the flow makes is visible.
const hears = createHearsMock();
const on = createOnMock();
const sendMessage = createSendMessageMock();

type EditTextParams = {
  chat_id: number | string;
  message_id: number;
  text?: string;
  rich_message?: { html: string };
  parse_mode?: string;
  reply_markup?: ReplyKeyboard;
};

const editMessageText = vi.fn<(params: EditTextParams) => Promise<unknown>>(
  async () => true,
);
const editMessageReplyMarkup = vi.fn<
  (params: {
    chat_id: number | string;
    message_id: number;
    reply_markup: ReplyKeyboard;
  }) => Promise<unknown>
>(async () => true);
const deleteMessage = vi.fn<
  (params: { chat_id: number | string; message_id: number }) => Promise<boolean>
>(async () => true);
const answerCallbackQuery = vi.fn<
  (params: {
    callback_query_id: string;
    text?: string;
    show_alert?: boolean;
  }) => Promise<unknown>
>(async () => true);
const sendWidget = vi.fn<
  (params: {
    chat_id: number;
    html: string;
    chat_data?: string;
    caption?: string;
    width?: number;
    height?: number;
    reply_markup?: ReplyKeyboard;
    reply_parameters?: { message_id: number };
  }) => Promise<{ message_id: number; widget: { html: string } }>
>(async () => ({ message_id: 70, widget: { html: "" } }));
const editMessageWidgetData = vi.fn<
  (params: {
    chat_id: number;
    message_id: number;
    chat_data?: string;
  }) => Promise<boolean>
>(async () => true);
const editMessageCaption = vi.fn<
  (params: {
    chat_id: number;
    message_id: number;
    caption?: string;
  }) => Promise<boolean>
>(async () => true);

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    command: vi.fn(),
    hears,
    on,
    api: {
      sendMessage,
      sendWidget,
      editMessageText,
      editMessageReplyMarkup,
      editMessageWidgetData,
      editMessageCaption,
      deleteMessage,
      answerCallbackQuery,
    },
  },
}));

vi.mock("../../src/services/student.service.js", () => ({
  getAttendanceCard: vi.fn(),
  getMidMarksCard: vi.fn(),
  getBunkPlanCard: vi.fn(),
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

vi.mock("../../src/db/registration.model.js", () => ({
  getRegistration: vi.fn(),
  upsertRegistration: vi.fn(),
}));

vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn(async () => ({ roll_no: "25KB1A05AR" })),
}));
vi.mock("../../src/db/student.model.js", () => ({ upsertTgUser: vi.fn() }));
vi.mock("../../src/db/student_stats.model.js", () => ({
  getLeaderboard: vi.fn(async () => ({
    rows: [
      {
        roll_no: "25KB1A05AA",
        name: "FIRST STUDENT",
        attendance_percentage: 91.5,
        mid_marks_avg: 24.5,
        rank: 1,
      },
    ],
    total: 1,
  })),
  getStudentRank: vi.fn(async () => ({ rank: 4, total: 60, value: 88.1 })),
}));
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
const { getRegistration, upsertRegistration } =
  await import("../../src/db/registration.model.js");
const { trackActivity } = await import("../../src/services/tracker.js");
const { upsertTgUser } = await import("../../src/db/student.model.js");
const { getStudentCached } = await import("../../src/services/redis/utils.js");
const { getLeaderboard } = await import("../../src/db/student_stats.model.js");
const { getVerificationState } =
  await import("../../src/services/verification/otp.js");
const { takeGroupPrompts } =
  await import("../../src/bot/academics/groupPrompt.js");

const rollHandler = firstHearsHandler<(ctx: unknown) => void>(hears);
const callbackHandler = registeredEventHandler<(ctx: unknown) => Promise<void>>(
  on,
  "callback_query",
);

const sendRoll = (userId: number, text = "25KB1A05AR", chatType = "private") =>
  rollHandler(
    contextFor({
      message: {
        chat: { id: userId, type: chatType },
        from: { id: userId, username: "student", first_name: "Student" },
        text,
        message_id: 7,
      },
      api: { sendMessage, answerCallbackQuery },
    }),
  );

const tap = (
  userId: number,
  data: string,
  messageId = 9,
  chatType = "private",
  widget?: { chat_data?: string },
) => {
  const callbackQuery = {
    id: `callback-${userId}-${data}`,
    from: { id: userId, username: "student", first_name: "Student" },
    data,
    message: {
      chat: { id: userId, type: chatType },
      message_id: messageId,
      text: "card",
      ...(widget ? { widget: { html: "", chat_data: widget.chat_data } } : {}),
    },
  };
  return callbackHandler(
    contextFor({
      callbackQuery,
      api: { sendMessage, answerCallbackQuery },
    }),
  );
};

const buttonsIn = (markup: ReplyKeyboard | undefined) =>
  markup?.inline_keyboard.flat() ?? [];

const callbackData = (markup: ReplyKeyboard | undefined) =>
  buttonsIn(markup).map((button) => button.callback_data);

const lastEdit = (): EditTextParams => {
  const call = editMessageText.mock.calls.at(-1);
  if (!call) throw new Error("the card was never edited");
  return call[0];
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

afterEach(() => {
  process.env.ATTENDANCE_WIDGET = "off";
});

describe("attendance card", () => {
  it("answers a typed roll with the attendance card instead of a menu", async () => {
    sendRoll(201);

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    expect(getAttendanceCard).toHaveBeenCalledWith("25KB1A05AR");

    const placeholder = sentMessage(sendMessage);
    expect(placeholder.text).toContain("Getting your attendance...");
    expect(placeholder.parse_mode).toBe("HTML");
    expect(placeholder.reply_parameters?.message_id).toBe(7);
    expect(callbackData(placeholder.reply_markup)).toContain("att_25KB1A05AR");

    const final = lastEdit();
    expect(final.text).toContain("Attendance for");
    expect(final.message_id).toBe(1);

    const sentText = sendMessage.mock.calls
      .map(([params]) => params.text)
      .join("\n");
    expect(sentText).not.toContain("What do you want to check?");
  });

  it("keeps Attendance, Mid marks, Bunk, Save and Leaderboard on the card", async () => {
    sendRoll(202);

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    const final = lastEdit();
    expect(callbackData(final.reply_markup)).toEqual(
      expect.arrayContaining([
        "att_25KB1A05AR",
        "mid_25KB1A05AR",
        "bunk_25KB1A05AR",
        "save_25KB1A05AR",
      ]),
    );

    const leaderboard = buttonsIn(final.reply_markup).find(
      (button) => button.text === "Leaderboard",
    );
    // the register is a page in the mini app now, not a chat answer
    expect(leaderboard?.callback_data).toBeUndefined();
    expect(leaderboard?.web_app?.url).toContain("?page=rank");
  });

  it.each(["group", "supergroup"])(
    "answers a roll in a %s with a private link, never the card",
    async (chatType) => {
      sendRoll(203, "25KB1A05AR", chatType);

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());

      const params = sentMessage(sendMessage);
      expect(params.chat_id).toBe(203);
      expect(params.text).toBe(
        "Your attendance is private. Tap to open it in the bot.",
      );
      // the roll travels in the button's link, never in the visible text
      expect(params.text).not.toContain("25KB1A05AR");
      expect(params.reply_parameters?.message_id).toBe(7);

      const buttons = buttonsIn(params.reply_markup);
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toEqual({
        text: "Open attendance",
        url: "https://t.me/NbkristQik_bot?start=att_25KB1A05AR",
        style: "primary",
      });

      // no portal read, no card, no last-lookup and no roll_lookup event
      expect(getAttendanceCard).not.toHaveBeenCalled();
      expect(editMessageText).not.toHaveBeenCalled();
      expect(trackActivity).not.toHaveBeenCalled();
      expect(getStudentCached).not.toHaveBeenCalled();
      expect(upsertTgUser).not.toHaveBeenCalled();

      // the prompt and the roll it replies to are parked so the private
      // /start can clear both from the room
      expect(takeGroupPrompts(203, "25KB1A05AR")).toEqual([
        { chatId: 203, messageId: 1, sourceMessageId: 7 },
      ]);
    },
  );

  it("parks no prompt for a private lookup", async () => {
    sendRoll(218);

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    expect(takeGroupPrompts(218, "25KB1A05AR")).toEqual([]);
  });

  it("answers a Leaderboard tap in the chat, by roll in a group", async () => {
    await tap(210, "lb", 9, "group");

    const params = sentMessage(sendMessage);
    expect(params.text).toContain("Attendance register");
    expect(params.text).toContain("25KB1A05AA");
    // a group message is forwarded: no classmate's name
    expect(params.text).not.toContain("FIRST STUDENT");
    expect(params.parse_mode).toBe("HTML");
    expect(getLeaderboard).toHaveBeenCalled();
  });

  it("names the register's top rows in a private chat, and the caller's rank", async () => {
    vi.mocked(getRegistration).mockResolvedValue({
      userId: "211",
      roll_no: "25KB1A05AR",
      display_name: null,
      registered_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00",
    });

    await tap(211, "lb");

    const params = sentMessage(sendMessage);
    expect(params.text).toContain("FIRST STUDENT");
    expect(params.text).toContain("You are #4 of 60 at 88.10%.");
  });

  it("edits the tapped card in place and never deletes it", async () => {
    await tap(204, "mid_25KB1A05AR", 9);

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(editMessageText).toHaveBeenCalledTimes(2);

    const placeholder = editMessageText.mock.calls[0][0];
    expect(placeholder.text).toContain("Getting your mid marks");
    expect(placeholder.message_id).toBe(9);

    const final = editMessageText.mock.calls[1][0];
    expect(final.text).toContain("Mid marks for");
    expect(final.message_id).toBe(9);
    expect(callbackData(final.reply_markup)).toEqual(
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

    const answer = answerCallbackQuery.mock.calls.at(-1)?.[0];
    expect(answer?.text).toContain("Saved");

    expect(editMessageReplyMarkup).toHaveBeenCalledTimes(1);
    const params = editMessageReplyMarkup.mock.calls[0][0];
    expect(params.chat_id).toBe(205);
    expect(params.message_id).toBe(9);
    expect(callbackData(params.reply_markup)).not.toContain("save_25KB1A05AR");
    expect(callbackData(params.reply_markup)).toEqual(
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
    expect(answerCallbackQuery.mock.calls.at(-1)?.[0]?.text).toBe(
      "Saved already",
    );
  });

  it("saves a different roll after the account verified another one", async () => {
    vi.mocked(getVerificationState).mockResolvedValueOnce({
      verified: true,
      roll: "25KB1A05AA",
      email: "25kb1a05aa@nbkrist.org",
      blocked: false,
      hideLeaderboard: false,
      blockLookups: false,
      blockRegistration: false,
    });

    await tap(210, "save_25KB1A05AR", 9);

    expect(upsertRegistration).toHaveBeenCalledWith("210", "25KB1A05AR", null);
    expect(answerCallbackQuery.mock.calls.at(-1)?.[0]?.text).toContain("Saved");
  });

  it("saves a roll another account already holds", async () => {
    // a shared roll is allowed now: the write goes through and the card's
    // Save button is replaced like any other save
    await tap(207, "save_25KB1A05AR", 9);

    expect(upsertRegistration).toHaveBeenCalledWith("207", "25KB1A05AR", null);
    expect(answerCallbackQuery.mock.calls.at(-1)?.[0]?.text).toContain("Saved");
    expect(editMessageReplyMarkup).toHaveBeenCalled();
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

    const final = lastEdit();
    expect(callbackData(final.reply_markup)).toEqual(
      expect.arrayContaining([
        "att_25KB1A05AX",
        "att_25KB1A05AR",
        "save_25KB1A05AX",
      ]),
    );
  });

  it("rejects a mutated callback without touching the card", async () => {
    await tap(209, "att_not-a-roll", 9);

    const answer = answerCallbackQuery.mock.calls.at(-1)?.[0];
    expect(answer?.text).toContain("doesn't look right");
    expect(editMessageText).not.toHaveBeenCalled();
    expect(editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it("uses the rich card when the service has one", async () => {
    vi.mocked(getAttendanceCard).mockResolvedValueOnce({
      text: "Attendance for 25KB1A05AR",
      rich: "<p>Attendance for <code>25KB1A05AR</code></p><table bordered striped compact><tr><th>Subject</th></tr></table>",
    });

    sendRoll(219);

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    const final = lastEdit();
    expect(final.rich_message?.html).toContain("<table");
    expect(final.rich_message?.html).toContain("25KB1A05AR");
    expect(final.text).toBeUndefined();
  });

  it("sends the HTML widget when it is enabled", async () => {
    process.env.ATTENDANCE_WIDGET = "all";
    vi.mocked(getAttendanceCard).mockResolvedValueOnce({
      text: "Attendance text",
      widget: {
        state: {
          v: 1,
          kind: "att",
          lines: [{ label: "Roll", value: "25KB1A05AR" }],
          meter: { value: 88.1, threshold: 75 },
          footer: "Stay above 75% and you're safe.",
        },
        caption: "Attendance · 25KB1A05AR · 88.10%",
      },
    });

    await sendRoll(230);

    const sent = sendWidget.mock.calls[0][0];
    expect(sent.chat_id).toBe(230);
    expect(sent.html).toContain("TelegramWidget");
    expect(JSON.parse(sent.chat_data ?? "{}").loading).toContain(
      "Getting your attendance",
    );
    expect(sent.caption).toContain("Getting your attendance");
    expect(callbackData(sent.reply_markup)).toContain("text_25KB1A05AR");
    expect(sent.width).toBe(0);
    expect(sent.height).toBe(0);

    const final = JSON.parse(
      editMessageWidgetData.mock.calls.at(-1)?.[0].chat_data ?? "{}",
    );
    expect(final.kind).toBe("att");
    expect(final.meter.value).toBe(88.1);
    expect(editMessageCaption.mock.calls.at(-1)?.[0].caption).toBe(
      "Attendance · 25KB1A05AR · 88.10%",
    );
    expect(editMessageText).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends a text card from a widget's Text card button", async () => {
    vi.mocked(getAttendanceCard).mockResolvedValueOnce({
      text: "The text card",
    });

    await tap(231, "text_25KB1A05AR", 70, "private", {
      chat_data: JSON.stringify({ v: 1, kind: "att" }),
    });

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalled());

    const placeholder = sentMessage(sendMessage);
    expect(placeholder.chat_id).toBe(231);
    expect(placeholder.reply_parameters?.message_id).toBe(70);

    const final = lastEdit();
    expect(final.text).toContain("The text card");
    expect(answerCallbackQuery.mock.calls.at(-1)?.[0].text).toBe(
      "Text card sent",
    );
    expect(sendWidget).not.toHaveBeenCalled();
    expect(editMessageWidgetData).not.toHaveBeenCalled();
  });

  it("updates an existing widget on a card tap instead of editing text", async () => {
    vi.mocked(getMidMarksCard).mockResolvedValueOnce({
      text: "Mid marks text",
      widget: {
        state: {
          v: 1,
          kind: "mid",
          lines: [{ label: "Roll", value: "25KB1A05AR" }],
        },
        caption: "Mid marks · 25KB1A05AR · 4 CSE C",
      },
    });

    await tap(232, "mid_25KB1A05AR", 70, "private", {
      chat_data: JSON.stringify({ v: 1, kind: "att" }),
    });

    await vi.waitFor(() => expect(editMessageWidgetData).toHaveBeenCalled());

    const final = JSON.parse(
      editMessageWidgetData.mock.calls.at(-1)?.[0].chat_data ?? "{}",
    );
    expect(final.kind).toBe("mid");
    expect(editMessageWidgetData.mock.calls.at(-1)?.[0].chat_id).toBe(232);
    expect(editMessageWidgetData.mock.calls.at(-1)?.[0].message_id).toBe(70);
    expect(editMessageCaption.mock.calls.at(-1)?.[0].caption).toContain(
      "Mid marks",
    );
    expect(editMessageText).not.toHaveBeenCalled();
    expect(sendWidget).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalled();
  });

  it("falls back to the HTML card when the client rejects rich", async () => {
    vi.mocked(getAttendanceCard).mockResolvedValueOnce({
      text: "Attendance for 25KB1A05AR",
      rich: "<p>rich card</p>",
    });
    editMessageText.mockRejectedValueOnce(
      new Error("Bad Request: rich unsupported"),
    );

    sendRoll(220);

    await vi.waitFor(() => expect(editMessageText).toHaveBeenCalledTimes(2));

    const fallback = editMessageText.mock.calls[1][0];
    expect(fallback.text).toContain("Attendance for");
    expect(fallback.rich_message).toBeUndefined();
  });
});
