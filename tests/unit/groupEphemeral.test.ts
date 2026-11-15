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
  reply_markup?: {
    inline_keyboard: { text?: string; url?: string; style?: string }[][];
  };
}

const { sendMessage, editMessageText, answerCallbackQuery } = vi.hoisted(
  () => ({
    sendMessage: vi.fn(async (_params: SendParams) => ({ message_id: 1 })),
    editMessageText: vi.fn(async (_params: unknown) => true),
    answerCallbackQuery: vi.fn(async (_params: unknown) => true),
  }),
);

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

const run = async (
  handler: (ctx: unknown) => unknown,
  message: unknown,
): Promise<void> => {
  await (handler as (ctx: { message: unknown }) => unknown)({ message });
};

const lastSend = (): SendParams => {
  const call = sendMessage.mock.calls.at(-1);
  if (!call) throw new Error("sendMessage was not called");
  return call[0] as SendParams;
};

const lastButton = () => lastSend().reply_markup?.inline_keyboard[0][0];

beforeEach(() => {
  sendMessage.mockClear();
  editMessageText.mockClear();
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
  it("sends the public link, never the card, when the command is public", async () => {
    await run(attendance, groupMessage());

    expect(getAttendanceCard).not.toHaveBeenCalled();
    const params = lastSend();
    expect(params.chat_id).toBe(-100123);
    expect(params.text).toContain("private");
    expect(params.reply_parameters).toEqual({ message_id: 7 });
    expect(lastButton()).toMatchObject({
      url: "https://t.me/NbkristQik_bot?start=att_25KB1A05AR",
      style: "primary",
    });
  });

  it("keeps the link private when the command itself is ephemeral", async () => {
    await run(
      attendance,
      groupMessage({
        message_id: 0,
        ephemeral_message_id: 55,
      }),
    );

    expect(getAttendanceCard).not.toHaveBeenCalled();
    expect(editMessageText).not.toHaveBeenCalled();

    const params = lastSend();
    expect(params.chat_id).toBe(-100123);
    expect(params.text).toContain("private");
    expect(params.reply_parameters).toEqual({ ephemeral_message_id: 55 });
    expect(params.ephemeral_message_parameters).toEqual({
      receiver_user_id: 42,
    });
    expect(lastButton()).toMatchObject({
      url: "https://t.me/NbkristQik_bot?start=att_25KB1A05AR",
    });
  });

  it("names the mid-mark card in the private link", async () => {
    await run(midmarks, groupMessage({ text: "/midmarks" }));

    const params = lastSend();
    expect(params.text).toContain("mid marks");
    expect(lastButton()?.url).toBe(
      "https://t.me/NbkristQik_bot?start=mid_25KB1A05AR",
    );
  });

  it("names the bunk card in the private link", async () => {
    await run(
      bunk,
      groupMessage({
        text: "/bunk",
        message_id: 0,
        ephemeral_message_id: 56,
      }),
    );

    const params = lastSend();
    expect(params.text).toContain("bunk plan");
    expect(params.reply_parameters).toEqual({ ephemeral_message_id: 56 });
    expect(lastButton()?.url).toBe(
      "https://t.me/NbkristQik_bot?start=bunk_25KB1A05AR",
    );
  });
});

describe("a tap on a card in the group", () => {
  it("refuses to re-render a public group card", async () => {
    await callback({
      callbackQuery: {
        id: "cb-1",
        from: { id: 42, username: "student", first_name: "Student" },
        data: "mid_25KB1A05AR",
        message: {
          chat: { id: -100123, type: "supergroup" },
          message_id: 9,
        },
      },
      answerCallbackQuery,
    });

    expect(editMessageText).not.toHaveBeenCalled();
    const answer = answerCallbackQuery.mock.calls.at(-1)?.[0] as
      { text?: string } | undefined;
    expect(answer?.text).toContain("private");
  });
});
