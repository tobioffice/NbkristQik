import { describe, it, expect, vi } from "vitest";

// Capture the roll handler; "you" identity writes must wait for authorization.
const onText = vi.fn();
const sendMessage = vi.fn(async () => ({ message_id: 1 }));
const getStudentCached = vi.fn(async () => ({ roll_no: "25KB1A05AR" }));
const upsertTgUser = vi.fn(async () => 1);
const isAuthorizedUser = vi.fn(async () => false);

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    onText,
    on: vi.fn(),
    sendMessage,
    deleteMessage: vi.fn(async () => true),
    answerCallbackQuery: vi.fn(async () => true),
  },
}));
vi.mock("../../src/services/redis/utils.js", () => ({ getStudentCached }));
vi.mock("../../src/db/student.model.js", () => ({ upsertTgUser }));
vi.mock("../../src/bot/authorization.js", () => ({
  isAuthorizedUser,
  rememberStudent: vi.fn(async () => undefined),
}));
vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
}));

await import("../../src/bot/academics/academicHandler.js");

const rollHandler = onText.mock.calls[0]?.[1] as (msg: unknown) => void;

const sendRoll = (userId: number, text: string) =>
  rollHandler({
    chat: { id: userId, type: "private" },
    from: { id: userId, username: "student", first_name: "Student" },
    text,
    message_id: 7,
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("roll-to-user mapping", () => {
  it("is not written for a blocked lookup", async () => {
    isAuthorizedUser.mockResolvedValue(false);

    sendRoll(101, "25KB1A05AR");
    await settle();

    expect(isAuthorizedUser).toHaveBeenCalled();
    expect(getStudentCached).not.toHaveBeenCalled();
    expect(upsertTgUser).not.toHaveBeenCalled();
  });

  it("is not written for a roll that fails validation", async () => {
    isAuthorizedUser.mockResolvedValue(true);

    sendRoll(102, "not-a-roll");
    await settle();

    expect(getStudentCached).not.toHaveBeenCalled();
    expect(upsertTgUser).not.toHaveBeenCalled();
  });

  it("is written for an authorized lookup", async () => {
    isAuthorizedUser.mockResolvedValue(true);

    sendRoll(103, "25KB1A05AR");

    await vi.waitFor(() => expect(upsertTgUser).toHaveBeenCalled());
    expect(getStudentCached).toHaveBeenCalledWith("25KB1A05AR");
    expect(upsertTgUser).toHaveBeenCalledWith("103", {
      roll_no: "25KB1A05AR",
    });
  });
});
