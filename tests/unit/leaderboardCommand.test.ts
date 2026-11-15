import { describe, it, expect, vi } from "vitest";
import {
  createCommandMock,
  createSendMessageMock,
  contextFor,
  registeredCommandHandler,
  sentMessage,
} from "../mocks/telegram.mock.js";

const command = createCommandMock();
const sendMessage = createSendMessageMock();

vi.mock("../../src/bot/bot.js", () => ({
  bot: { command, api: { sendMessage } },
}));
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
        roll_no: "99KB9A9999",
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
    roll_no: "99KB9A9999",
    display_name: null,
    registered_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
  })),
}));
vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn(async () => ({
    roll_no: "99KB9A9999",
    year: "31",
    branch: "5",
    section: "A",
  })),
}));

await import("../../src/bot/commands/leaderboard.js");

const handler = registeredCommandHandler<(ctx: unknown) => unknown>(
  command,
  "leaderboard",
);

const run = async (chatType: string) => {
  sendMessage.mockClear();
  const message = {
    chat: { id: 42, type: chatType },
    from: { id: 42 },
    message_id: 9,
  };
  await handler(contextFor({ message, match: "", api: { sendMessage } }));
  return sentMessage(sendMessage);
};

describe("/leaderboard", () => {
  it("prints the register in the chat instead of opening a page", async () => {
    const params = await run("private");

    expect(params.chat_id).toBe(42);
    expect(params.text).toContain("Attendance register");
    expect(params.text).toContain("ASHA");
    expect(params.text).toContain("92.50%");
    expect(params.text).toContain("You are #3 of 12 at 88.10%.");
    expect(params.text).toContain("3rd year · CSE · A");
    expect(params.parse_mode).toBe("HTML");
    expect(params.reply_parameters?.message_id).toBe(9);
    expect(params.reply_markup).toBeUndefined();
  });

  it("prints rolls, not names, in a group", async () => {
    const params = await run("supergroup");

    expect(params.text).toContain("99KB9A9999");
    expect(params.text).not.toContain("ASHA");
    expect(params.text).not.toContain("You are #");
  });
});
