import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The daily run's question choice.
 *
 * A player's second or later run must not contain a question they have
 * already been shown. The day's pool is the first source; the rest of the
 * bank fills any shortfall, so only an exhausted bank can repeat a question.
 */

const mocks = vi.hoisted(() => ({
  loadPlayer: vi.fn(),
  getOrCreateDailyRound: vi.fn(),
  getAttemptForRound: vi.fn(),
  getAttempt: vi.fn(),
  createAttempt: vi.fn(),
  getSeenQuestionIds: vi.fn(),
  getActiveQuestionIds: vi.fn(),
  sendRegistrationPrompt: vi.fn(),
  sendOrEdit: vi.fn(),
  showQuestion: vi.fn(),
}));

vi.mock("../../src/bot/bot.js", () => ({
  bot: { api: {}, command: vi.fn() },
}));

vi.mock("../../src/db/game.model.js", () => ({
  addScore: vi.fn(),
  createAttempt: mocks.createAttempt,
  finishAttempt: vi.fn(),
  getActiveQuestionIds: mocks.getActiveQuestionIds,
  getAttempt: mocks.getAttempt,
  getAttemptForRound: mocks.getAttemptForRound,
  getFiveRank: vi.fn(),
  getGamePlayer: vi.fn(),
  getOrCreateDailyRound: mocks.getOrCreateDailyRound,
  getQuestionsByIds: vi.fn(),
  getSectionWeek: vi.fn(),
  getSeenQuestionIds: mocks.getSeenQuestionIds,
  setPlayerStreak: vi.fn(),
}));

vi.mock("../../src/games/player.js", () => ({
  loadPlayer: mocks.loadPlayer,
  sendRegistrationPrompt: mocks.sendRegistrationPrompt,
}));

vi.mock("../../src/games/play.js", () => ({
  sendOrEdit: mocks.sendOrEdit,
  showQuestion: mocks.showQuestion,
}));

vi.mock("../../src/services/tracker.js", () => ({ trackActivity: vi.fn() }));
vi.mock("../../src/games/cards.js", () => ({ fiveResultCard: vi.fn() }));

const { startFiveRun } = await import("../../src/games/five.js");

const pool = Array.from({ length: 10 }, (_, index) => index + 1);
const bank = Array.from({ length: 20 }, (_, index) => index + 1);

let created: { questionIds: number[] } | undefined;

const attempt = (questionIds: number[]) => ({
  id: 77,
  game: "five" as const,
  roundKey: "five-2026-11-24",
  dayKey: "2026-11-24",
  weekKey: "2026-W47",
  season: "S1",
  userId: 42,
  rollNo: "23KB1A0042",
  sectionKey: "4|CSE|C",
  sectionLabel: "4 CSE C",
  questionIds,
  answers: [],
  idx: 0,
  score: 0,
  points: 0,
  streak: 0,
  duelId: null,
  status: "active" as const,
  startedAt: "2026-11-24T03:00:00.000Z",
  shownAt: null,
  finishedAt: null,
});

beforeEach(() => {
  created = undefined;
  mocks.loadPlayer.mockReset();
  mocks.loadPlayer.mockResolvedValue({
    userId: 42,
    rollNo: "23KB1A0042",
    displayName: null,
    sectionKey: "4|CSE|C",
    sectionLabel: "4 CSE C",
    streak: 0,
    bestStreak: 0,
    lastFive: null,
  });
  mocks.getOrCreateDailyRound.mockReset();
  mocks.getOrCreateDailyRound.mockResolvedValue({
    id: "five-2026-11-24",
    game: "five",
    dayKey: "2026-11-24",
    questionIds: pool,
  });
  mocks.getAttemptForRound.mockReset();
  mocks.getAttemptForRound.mockResolvedValue(null);
  mocks.createAttempt.mockReset();
  mocks.createAttempt.mockImplementation(
    async (input: { questionIds: number[] }) => {
      created = input;
      return 77;
    },
  );
  mocks.getAttempt.mockReset();
  mocks.getAttempt.mockImplementation(async () =>
    attempt(created?.questionIds ?? []),
  );
  mocks.getSeenQuestionIds.mockReset();
  mocks.getSeenQuestionIds.mockResolvedValue([]);
  mocks.getActiveQuestionIds.mockReset();
  mocks.getActiveQuestionIds.mockResolvedValue(bank);
});

describe("startFiveRun question choice", () => {
  it("starts the first run without a repeated question", async () => {
    const started = await startFiveRun(42);

    expect(started.state).toBe("playing");
    expect(created?.questionIds).toHaveLength(10);
    expect(new Set(created?.questionIds).size).toBe(10);
    // the first run is drawn from the day's pool
    expect(created?.questionIds.every((id) => pool.includes(id))).toBe(true);
  });

  it("keeps every question the player has seen out of the next run", async () => {
    // the player has seen half the pool and five more from other days
    mocks.getSeenQuestionIds.mockResolvedValue([
      1, 2, 3, 4, 5, 11, 12, 13, 14, 15,
    ]);

    const started = await startFiveRun(42);

    expect(started.state).toBe("playing");
    const ids = created?.questionIds ?? [];
    expect(ids).toHaveLength(10);
    expect(ids.some((id) => [1, 2, 3, 4, 5].includes(id))).toBe(false);
    // the pool leaves five unseen, so five more come from the rest of the bank
    expect(ids.filter((id) => pool.includes(id))).toHaveLength(5);
    expect(ids.filter((id) => !pool.includes(id))).toHaveLength(5);
  });

  it("resumes today's run without choosing new questions", async () => {
    mocks.getAttemptForRound.mockResolvedValue(attempt(pool));

    const started = await startFiveRun(42);

    expect(started).toMatchObject({ state: "playing", created: false });
    expect(mocks.createAttempt).not.toHaveBeenCalled();
    expect(mocks.getSeenQuestionIds).not.toHaveBeenCalled();
    expect(mocks.getActiveQuestionIds).not.toHaveBeenCalled();
  });

  it("does not build a run when the bank cannot fill one", async () => {
    mocks.getOrCreateDailyRound.mockResolvedValue(null);

    expect(await startFiveRun(42)).toEqual({ state: "not-ready" });
    expect(mocks.createAttempt).not.toHaveBeenCalled();
  });
});
