import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "node-telegram-bot-api";
import { turso } from "../../src/db/db.js";
import {
  getAttempt,
  getAttemptForRound,
  getDuel,
  getDuelByAttempt,
  initGameTables,
} from "../../src/db/game.model.js";
import { istStamp } from "../../src/games/time.js";

const users: Record<
  number,
  { roll: string; section: string; branch: string; year: string }
> = {
  42: { roll: "23KB1A0599", section: "C", branch: "CSE", year: "42" },
  43: { roll: "23KB1A0600", section: "C", branch: "CSE", year: "42" },
};

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(async (_params: Record<string, unknown>) => ({
    message_id: 100,
  })),
  editMessageText: vi.fn(async (_params: Record<string, unknown>) => true),
  answerCallbackQuery: vi.fn(async (_params?: Record<string, unknown>) => true),
  getRegistration: vi.fn(),
  getStudentCached: vi.fn(),
  trackActivity: vi.fn(),
  trackMessage: vi.fn(),
}));

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    api: {
      sendMessage: mocks.sendMessage,
      editMessageText: mocks.editMessageText,
      answerCallbackQuery: mocks.answerCallbackQuery,
    },
    command: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock("../../src/db/registration.model.js", () => ({
  getRegistration: mocks.getRegistration,
}));

vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: mocks.getStudentCached,
}));

vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: mocks.trackActivity,
  trackMessage: mocks.trackMessage,
}));

const { startDailyFive } = await import("../../src/games/five.js");
const { startDuel, sendDuelRecord } = await import("../../src/games/duel.js");
const { handleGameCallback } = await import("../../src/games/handler.js");

const clear = async (): Promise<void> => {
  for (const table of [
    "game_questions",
    "game_rounds",
    "game_players",
    "game_attempts",
    "game_duels",
    "game_scores",
    "game_posts",
  ]) {
    await turso.execute(`DELETE FROM ${table}`);
  }
};

const seedQuestions = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) {
    await turso.execute({
      sql: `INSERT INTO game_questions (slug, prompt, options, correct, topic)
            VALUES (?, ?, ?, 0, 'test')`,
      args: [
        `q${index}`,
        `Question ${index + 1}?`,
        JSON.stringify(["Right", "Wrong", "Wrong", "Wrong"]),
      ],
    });
  }
};

const context = (userId: number, data: string, chatId = 900): Context =>
  ({
    callbackQuery: {
      id: `cb-${data}`,
      from: { id: userId, is_bot: false, first_name: "Test" },
      data,
      message: {
        chat: { id: chatId, type: "private" },
        message_id: 100,
        date: 0,
      },
    },
    answerCallbackQuery: mocks.answerCallbackQuery,
  }) as unknown as Context;

const lastSent = () =>
  mocks.sendMessage.mock.calls.at(-1)?.[0] as
    { text?: string; chat_id?: number; reply_markup?: unknown } | undefined;

const lastEdit = () =>
  mocks.editMessageText.mock.calls.at(-1)?.[0] as
    { text?: string; message_id?: number } | undefined;

const answerAll = async (
  attemptId: number,
  userId: number,
  chatId = 900,
  wrongAt = -1,
): Promise<void> => {
  for (let index = 0; index < 5; index += 1) {
    const option = index === wrongAt ? 1 : 0;
    await handleGameCallback(
      context(userId, `q5_${attemptId}_${index}_${option}`, chatId),
    );
  }
};

beforeEach(async () => {
  await initGameTables();
  await clear();
  await seedQuestions();

  mocks.sendMessage.mockClear();
  mocks.editMessageText.mockClear();
  mocks.answerCallbackQuery.mockClear();
  mocks.trackActivity.mockClear();
  mocks.trackMessage.mockClear();

  mocks.getRegistration.mockImplementation(async (userId: string) => {
    const user = users[Number(userId)];
    return user
      ? {
          userId,
          roll_no: user.roll,
          display_name: null,
          registered_at: "2026-01-01 00:00:00",
          updated_at: "2026-01-01 00:00:00",
        }
      : null;
  });

  mocks.getStudentCached.mockImplementation(async (roll: string) => {
    const entry = Object.values(users).find((user) => user.roll === roll);
    if (!entry) throw new Error("not found");
    return {
      roll_no: entry.roll,
      name: "Test Student",
      section: entry.section,
      branch: entry.branch,
      year: entry.year,
    };
  });
});

describe("the Five flow", () => {
  it("plays five questions and prints the result", async () => {
    await startDailyFive({ chatId: 900, userId: 42 });

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(lastSent()?.text).toContain("Question 1 of 5");
    expect(lastSent()?.text).toContain("Fast answers score more");

    const attempt = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );
    expect(attempt).not.toBeNull();

    await answerAll(attempt!.id, 42);

    const result = lastEdit();
    expect(result?.text).toContain("Five done");
    expect(result?.text).toContain("5 of 5 correct");
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    const done = await getAttempt(attempt!.id);
    expect(done?.status).toBe("done");
    expect(done?.points).toBeGreaterThanOrEqual(700);
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith({
      text: expect.stringContaining("Correct +"),
    });
  });

  it("resumes the same five instead of starting a second run", async () => {
    await startDailyFive({ chatId: 900, userId: 42 });
    const attempt = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );

    await startDailyFive({ chatId: 900, userId: 42 });

    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    expect(lastSent()?.text).toContain("Question 1 of 5");
    const stillOne = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );
    expect(stillOne?.id).toBe(attempt?.id);
  });

  it("shows the finished card on a second visit", async () => {
    await startDailyFive({ chatId: 900, userId: 42 });
    const attempt = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );
    await answerAll(attempt!.id, 42);

    await startDailyFive({ chatId: 900, userId: 42 });

    expect(lastSent()?.text).toContain("already played today");
  });

  it("turns the run into a duel and closes it for both sides", async () => {
    await startDailyFive({ chatId: 900, userId: 42 });
    const attempt = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );
    await answerAll(attempt!.id, 42);

    await handleGameCallback(context(42, `duel_new_${attempt!.id}`));

    const invite = lastSent();
    expect(invite?.text).toContain("Challenge ready");
    const duel = await getDuelByAttempt(attempt!.id);
    expect(duel?.status).toBe("open");
    expect(duel?.challengerScore).toBeGreaterThanOrEqual(700);

    await startDuel({ chatId: 901, userId: 43, duelId: duel!.id });
    const duelCard = lastSent();
    expect(duelCard?.text).toContain("Duel · Question 1 of 5");
    expect(duelCard?.text).toContain("Target: <b>");

    const opponent = await getAttemptForRound("duel", `d${duel!.id}`, 43);
    expect(opponent).not.toBeNull();

    // One wrong answer: the challenger's ~750 beats the opponent's ~600.
    await answerAll(opponent!.id, 43, 901, 0);

    const closed = await getDuel(duel!.id);
    expect(closed?.status).toBe("done");
    expect(closed?.opponentScore).toBeGreaterThanOrEqual(550);
    expect(closed?.opponentScore).toBeLessThan(duel!.challengerScore);
    expect(closed?.winnerId).toBe(42);

    expect(lastEdit()?.text).toContain("Duel result");
    expect(lastEdit()?.text).toContain("You <b>");

    const challengerDm = mocks.sendMessage.mock.calls.find(
      ([params]) =>
        Number(params.chat_id) === 42 &&
        String(params.text).includes("Duel result"),
    );
    expect(challengerDm).toBeTruthy();

    await sendDuelRecord({ chatId: 900, userId: 42 });
    expect(lastSent()?.text).toContain("1 win");
    expect(lastSent()?.text).toContain("0 losses");
  });
});
