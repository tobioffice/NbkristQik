import { describe, it, expect, vi } from "vitest";

// Capture the handler the module registers and the message it sends instead
// of talking to Telegram.
const onText = vi.fn();
const sendMessage = vi.fn(async () => ({ message_id: 1 }));

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    onText,
    on: vi.fn(),
    sendMessage,
    deleteMessage: vi.fn(async () => true),
    answerCallbackQuery: vi.fn(async () => true),
  },
}));
vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn(async () => ({ roll_no: "25KB1A05AR" })),
}));
vi.mock("../../src/db/student.model.js", () => ({ upsertTgUser: vi.fn() }));
vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
}));
vi.mock("../../src/bot/authorization.js", () => ({
  isAuthorizedUser: vi.fn(async () => true),
  rememberStudent: vi.fn(async () => undefined),
}));

await import("../../src/bot/academics/academicHandler.js");

const rollHandler = onText.mock.calls[0]?.[1] as (msg: unknown) => void;

const sendRoll = (text: string) =>
  rollHandler({
    chat: { id: 42, type: "private" },
    from: { id: 42, username: "student", first_name: "Student" },
    text,
    message_id: 7,
  });

describe("roll number O/0 notice", () => {
  it("renders the correction notice as HTML, not literal code tags", async () => {
    sendMessage.mockClear();

    sendRoll("25KB1AO5AR");

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());

    const [, text, options] = sendMessage.mock.calls[0] as [
      number,
      string,
      { parse_mode?: string },
    ];
    expect(text).toContain("<code>25KB1A05AR</code>");
    // the tags only render when the message is sent as HTML
    expect(options.parse_mode).toBe("HTML");
  });

  it("sends no notice when the roll was typed correctly", async () => {
    sendMessage.mockClear();

    sendRoll("25KB1A05AR");

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());

    const [, text] = sendMessage.mock.calls[0] as [number, string];
    expect(text).not.toContain("Heads up");
    expect(text).not.toContain("<code>");
  });
});
