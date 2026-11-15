import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSendMessageMock,
  replyKeyboard,
  sentMessage,
} from "../mocks/telegram.mock.js";

// The command modules are captured instead of talking to Telegram.
const sendMessage = createSendMessageMock();

vi.mock("../../src/bot/bot.js", () => ({
  bot: { command: vi.fn(), api: { sendMessage } },
}));
vi.mock("../../src/services/tracker.js", () => ({ trackMessage: vi.fn() }));
vi.mock("../../src/bot/academics/studentActions.js", () => ({
  sendAttendanceOrMidMarks: vi.fn(),
  sendBunkPlan: vi.fn(),
}));
const getRegistration = vi.fn();
vi.mock("../../src/db/registration.model.js", () => ({
  getRegistration,
}));
const getStudentCached = vi.fn();
vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached,
  StudentNotFoundError: class StudentNotFoundError extends Error {},
}));
vi.mock("../../src/db/student.model.js", () => ({ upsertTgUser: vi.fn() }));
vi.mock("../../src/bot/authorization.js", () => ({
  isAuthorizedUser: vi.fn(async () => true),
}));
vi.mock("../../src/middleware/security.js", () => ({
  botSecurityHandler: vi.fn(async () => true),
}));

const { resolveRegisteredRoll } =
  await import("../../src/bot/commands/registered.js");
const { REGISTER_WEBAPP_URL, appDirectLink } =
  await import("../../src/constants/webapp.js");
const { StudentNotFoundError } =
  await import("../../src/services/redis/utils.js");

const sentButton = () =>
  replyKeyboard(sentMessage(sendMessage)).inline_keyboard[0][0];

beforeEach(() => {
  sendMessage.mockClear();
  getRegistration.mockReset();
  getRegistration.mockResolvedValue(null);
  getStudentCached.mockReset();
});

const registration = {
  user_id: "42",
  roll_no: "25KB1A05AR",
  display_name: null,
  registered_at: "2026-01-01",
  updated_at: "2026-01-01",
};

describe("promptRegister", () => {
  it("is a web_app button in a private chat", async () => {
    await resolveRegisteredRoll(42, 42, true);

    expect(sentButton()).toEqual({
      text: "👤 Register your roll",
      web_app: { url: REGISTER_WEBAPP_URL },
      style: "primary",
    });
  });

  it("is a direct link in a group, so the prompt is actually sent", async () => {
    await resolveRegisteredRoll(42, -100123, false);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sentButton()).toEqual({
      text: "👤 Register your roll",
      url: appDirectLink("profile"),
      style: "primary",
    });
    expect(JSON.stringify(sentButton())).not.toContain("web_app");
  });
});

describe("a saved roll the portal no longer knows", () => {
  it("asks for a new roll instead of failing the command", async () => {
    getRegistration.mockResolvedValue(registration);
    getStudentCached.mockRejectedValueOnce(
      new StudentNotFoundError("25KB1A05AR", []),
    );

    await resolveRegisteredRoll(42, 42, true);

    expect(sentMessage(sendMessage).text).toContain(
      "isn't in the college records anymore",
    );
    expect(sentButton().text).toBe("👤 Register your roll");
  });
});

describe("a cache or database hiccup", () => {
  it("does not tell the student the roll was deleted", async () => {
    getRegistration.mockResolvedValue(registration);
    getStudentCached.mockRejectedValueOnce(new Error("redis down"));

    await resolveRegisteredRoll(42, 42, true);

    const text = sentMessage(sendMessage).text;
    expect(text).toContain("Couldn't check your roll");
    expect(text).not.toContain("isn't in the college records");
  });
});
