import { describe, it, expect, vi } from "vitest";
import {
  createOnTextMock,
  createSendMessageMock,
  registeredTextHandler,
  sentMessage,
} from "../mocks/telegram.mock.js";

const onText = createOnTextMock();
const sendMessage = createSendMessageMock();

vi.mock("../../src/bot/bot.js", () => ({ bot: { onText, sendMessage } }));
vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
  trackMessage: vi.fn(),
}));
vi.mock("../../src/middleware/security.js", () => ({
  botSecurityHandler: vi.fn(async () => true),
}));
vi.mock("../../src/db/student_stats.model.js", () => ({
  getLeaderboard: vi.fn(async () => ({
    rows: [
      {
        roll_no: "23KB1A0599",
        name: "ASHA",
        attendance_percentage: 92.5,
        mid_marks_avg: 24,
        rank: 1,
      },
    ],
    total: 12,
  })),
  getStudentRank: vi.fn(async () => ({ rank: 3, total: 12, value: 88.1 })),
}));
vi.mock("../../src/db/registration.model.js", () => ({
  getRegistration: vi.fn(async () => ({
    userId: "42",
    roll_no: "23KB1A0599",
    display_name: null,
    registered_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
  })),
}));
vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn(async () => ({
    roll_no: "23KB1A0599",
    year: "31",
    branch: "5",
    section: "A",
  })),
}));

await import("../../src/bot/commands/leaderboard.js");

const handler = registeredTextHandler<(msg: unknown) => void>(
  onText,
  "/leaderboard",
);

const run = async (chatType: string) => {
  sendMessage.mockClear();
  await handler({
    chat: { id: 42, type: chatType },
    from: { id: 42 },
    message_id: 9,
  });
  return sentMessage(sendMessage);
};

describe("/leaderboard", () => {
  it("prints the register in the chat instead of opening a page", async () => {
    const [chatId, text, options] = await run("private");

    expect(chatId).toBe(42);
    expect(text).toContain("Attendance register");
    expect(text).toContain("ASHA");
    expect(text).toContain("92.50%");
    expect(text).toContain("You are #3 of 12 at 88.10%.");
    expect(text).toContain("3rd year · CSE · A");
    expect(options.parse_mode).toBe("HTML");
    expect(options.reply_to_message_id).toBe(9);
    expect(options.reply_markup).toBeUndefined();
  });

  it("prints rolls, not names, in a group", async () => {
    const [, text] = await run("supergroup");

    expect(text).toContain("23KB1A0599");
    expect(text).not.toContain("ASHA");
    expect(text).not.toContain("You are #");
  });
});
