import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCommandMock,
  createOnMock,
  registeredCommandHandler,
  registeredEventHandler,
} from "../mocks/telegram.mock.js";

interface SendParams {
  chat_id?: number | string;
  text?: string;
  reply_parameters?: {
    message_id?: number;
    ephemeral_message_id?: number;
  };
  ephemeral_message_parameters?: { receiver_user_id?: number };
  reply_markup?: { inline_keyboard: { url?: string }[][] };
}

interface EditParams {
  chat_id?: number | string;
  receiver_user_id?: number;
  ephemeral_message_id?: number;
  text?: string;
  rich_message?: { html: string };
}

const {
  sendMessage,
  editMessageText,
  editEphemeralMessageText,
  editEphemeralMessageReplyMarkup,
  answerCallbackQuery,
} = vi.hoisted(() => ({
  sendMessage: vi.fn(async (params: SendParams) =>
    params.ephemeral_message_parameters
      ? { message_id: 0, ephemeral_message_id: 77 }
      : { message_id: 1 },
  ),
  editMessageText: vi.fn(async (_params: EditParams) => true),
  editEphemeralMessageText: vi.fn(async (_params: EditParams) => true),
  editEphemeralMessageReplyMarkup: vi.fn(
    async (_params: EditParams & { reply_markup?: unknown }) => true,
  ),
  answerCallbackQuery: vi.fn(async () => true),
}));

const command = createCommandMock();
const on = createOnMock();

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    command,
    hears: vi.fn(),
    on,
    api: {
      sendMessage,
      editMessageText,
      editEphemeralMessageText,
      editEphemeralMessageReplyMarkup,
      editMessageReplyMarkup: vi.fn(async () => true),
      answerCallbackQuery,
      deleteMessage: vi.fn(async () => true),
    },
  },
}));

const getRegistration = vi.fn();
const upsertRegistration = vi.fn();
vi.mock("../../src/db/registration.model.js", () => ({
  getRegistration,
  upsertRegistration,
}));
const getStudentCached = vi.fn();
vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached,
  StudentNotFoundError: class StudentNotFoundError extends Error {},
}));
vi.mock("../../src/db/student.model.js", () => ({
  upsertTgUser: vi.fn(async () => 1),
}));
vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
  trackMessage: vi.fn(),
}));
vi.mock("../../src/bot/authorization.js", () => ({
  isAuthorizedUser: vi.fn(async () => true),
  rememberStudent: vi.fn(async () => undefined),
}));
vi.mock("../../src/middleware/security.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/middleware/security.js")>();
  return { ...actual, botSecurityHandler: vi.fn(async () => true) };
});
vi.mock("../../src/services/verification/otp.js", () => ({
  isLookupBlockedForViewer: vi.fn(async () => false),
  isRegistrationBlockedFor: vi.fn(async () => false),
}));
vi.mock("../../src/services/library/entitlement.js", () => ({
  invalidateStudentContext: vi.fn(),
}));
vi.mock("../../src/db/student_stats.model.js", () => ({
  getLeaderboard: vi.fn(),
  getStudentRank: vi.fn(),
}));

const getAttendanceCard = vi.fn();
const getMidMarksCard = vi.fn();
const getBunkPlanCard = vi.fn();
vi.mock("../../src/services/student.service.js", () => ({
  getAttendanceCard,
  getMidMarksCard,
  getBunkPlanCard,
}));

await import("../../src/bot/commands/registered.js");
await import("../../src/bot/academics/academicHandler.js");

const attendance = registeredCommandHandler<(ctx: unknown) => unknown>(
  command,
  "attendance",
);
const midmarks = registeredCommandHandler<(ctx: unknown) => unknown>(
  command,
  "midmarks",
);
const bunk = registeredCommandHandler<(ctx: unknown) => unknown>(
  command,
  "bunk",
);
const callback = registeredEventHandler<(ctx: unknown) => Promise<void>>(
  on,
  "callback_query",
);

const groupMessage = (extra: Record<string, unknown> = {}) => ({
  chat: { id: -100123, type: "supergroup" },
  from: { id: 42, username: "student", first_name: "Student" },
  message_id: 7,
  text: "/attendance",
  ...extra,
});

const run = async (message: unknown) =>
  (attendance as (ctx: { message: unknown }) => unknown)({ message });

const lastEphemeralEdit = (): EditParams => {
  const call = editEphemeralMessageText.mock.calls.at(-1);
  if (!call) throw new Error("the ephemeral card was never edited");
  return call[0];
};

beforeEach(() => {
  sendMessage.mockClear();
  editMessageText.mockClear();
  editEphemeralMessageText.mockClear();
  answerCallbackQuery.mockClear();
  getRegistration.mockReset();
  getRegistration.mockResolvedValue({
    user_id: "42",
    roll_no: "25KB1A05AR",
    display_name: null,
    registered_at: "2026-01-01",
    updated_at: "2026-01-01",
  });
  getStudentCached.mockReset();
  getStudentCached.mockResolvedValue({
    roll_no: "25KB1A05AR",
    name: "ASHA",
    branch: "ECE",
    section: "D",
    year: "2",
  });
  getAttendanceCard.mockReset();
  getAttendanceCard.mockResolvedValue({ text: "Attendance card" });
  getMidMarksCard.mockReset();
  getMidMarksCard.mockResolvedValue({ text: "Mid marks card" });
  getBunkPlanCard.mockReset();
  getBunkPlanCard.mockResolvedValue({ text: "Bunk card" });
});

describe("a group lookup command", () => {
  it("sends the private link, never the card, when the command is public", async () => {
    await run(groupMessage());

    expect(getAttendanceCard).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const params = sendMessage.mock.calls[0][0] as SendParams;
    expect(params.chat_id).toBe(-100123);
    expect(params.text).toContain("private");
    expect(params.reply_parameters).toEqual({ message_id: 7 });
    expect(params.reply_markup?.inline_keyboard[0][0].url).toBe(
      "https://t.me/NbkristQik_bot?start=att_25KB1A05AR",
    );
  });

  it("names the mid-mark card in the private link", async () => {
    await (midmarks as (ctx: { message: unknown }) => unknown)({
      message: groupMessage({ text: "/midmarks" }),
    });

    const params = sendMessage.mock.calls[0][0] as SendParams;
    expect(params.text).toContain("mid marks");
    expect(params.reply_markup?.inline_keyboard[0][0].url).toBe(
      "https://t.me/NbkristQik_bot?start=mid_25KB1A05AR",
    );
  });

  it("answers an ephemeral bunk command privately", async () => {
    await (bunk as (ctx: { message: unknown }) => unknown)({
      message: groupMessage({
        text: "/bunk",
        message_id: 0,
        ephemeral_message_id: 56,
      }),
    });

    await vi.waitFor(() => expect(editEphemeralMessageText).toHaveBeenCalled());

    const sent = sendMessage.mock.calls[0][0] as SendParams;
    expect(sent.reply_parameters).toEqual({ ephemeral_message_id: 56 });
    expect(lastEphemeralEdit().text).toContain("Bunk card");
  });

  it("answers an ephemeral command with a card only its sender can see", async () => {
    await run(groupMessage({ message_id: 0, ephemeral_message_id: 55 }));

    await vi.waitFor(() => expect(editEphemeralMessageText).toHaveBeenCalled());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sent = sendMessage.mock.calls[0][0] as SendParams;
    expect(sent.chat_id).toBe(-100123);
    expect(sent.reply_parameters).toEqual({ ephemeral_message_id: 55 });
    expect(sent.ephemeral_message_parameters).toEqual({
      receiver_user_id: 42,
    });

    const edited = lastEphemeralEdit();
    expect(edited.chat_id).toBe(-100123);
    expect(edited.receiver_user_id).toBe(42);
    expect(edited.ephemeral_message_id).toBe(77);
    expect(edited.text).toContain("Attendance card");
    expect(editMessageText).not.toHaveBeenCalled();
  });
});

describe("a tap on an ephemeral card", () => {
  it("edits the ephemeral message, not a public one", async () => {
    await callback({
      callbackQuery: {
        id: "cb-1",
        from: { id: 42, username: "student", first_name: "Student" },
        data: "mid_25KB1A05AR",
        message: {
          chat: { id: -100123, type: "supergroup" },
          message_id: 0,
          ephemeral_message_id: 77,
        },
      },
      answerCallbackQuery,
    });

    await vi.waitFor(() => expect(editEphemeralMessageText).toHaveBeenCalled());

    const edited = lastEphemeralEdit();
    expect(edited.ephemeral_message_id).toBe(77);
    expect(edited.receiver_user_id).toBe(42);
    expect(edited.text).toContain("Mid marks card");
    expect(editMessageText).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalled();
  });
});
