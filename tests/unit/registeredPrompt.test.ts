import { describe, it, expect, vi } from "vitest";
import {
  createOnTextMock,
  createSendMessageMock,
  replyKeyboard,
  sentMessage,
} from "../mocks/telegram.mock.js";

// The command modules are captured instead of talking to Telegram.
const onText = createOnTextMock();
const sendMessage = createSendMessageMock();

vi.mock("../../src/bot/bot.js", () => ({
  bot: { onText, sendMessage },
}));
vi.mock("../../src/services/tracker.js", () => ({ trackMessage: vi.fn() }));
vi.mock("../../src/bot/academics/studentActions.js", () => ({
  sendAttendanceOrMidMarks: vi.fn(),
  sendBunkPlan: vi.fn(),
}));
vi.mock("../../src/db/registration.model.js", () => ({
  getRegistration: vi.fn(async () => null),
}));
vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn(),
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
const { REGISTER_WEBAPP_URL } = await import("../../src/constants/webapp.js");

const sentButton = () =>
  replyKeyboard(sentMessage(sendMessage)[2]).inline_keyboard[0][0];

describe("promptRegister", () => {
  it("is a web_app button in a private chat", async () => {
    await resolveRegisteredRoll(42, 42, true);

    expect(sentButton()).toEqual({
      text: "👤 Register your roll",
      web_app: { url: REGISTER_WEBAPP_URL },
    });
  });

  it("is a plain link in a group, so the prompt is actually sent", async () => {
    sendMessage.mockClear();

    await resolveRegisteredRoll(42, -100123, false);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sentButton()).toEqual({
      text: "👤 Register your roll",
      url: REGISTER_WEBAPP_URL,
    });
    expect(JSON.stringify(sentButton())).not.toContain("web_app");
  });
});
