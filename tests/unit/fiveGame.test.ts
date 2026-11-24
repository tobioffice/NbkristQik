import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "node-telegram-bot-api";
import { turso } from "../../src/db/db.js";
import {
  createAttempt,
  getAttempt,
  getAttemptForRound,
  getDuel,
  getDuelByAttempt,
  getGamePlayer,
  getOrCreateDailyRound,
  initGameTables,
  upsertGamePlayer,
} from "../../src/db/game.model.js";
import { DAILY_POOL_SIZE, QUESTIONS_PER_RUN } from "../../src/games/scoring.js";
import { istStamp } from "../../src/games/time.js";

const users: Record<
  number,
  { roll: string; section: string; branch: string; year: string }
> = {
  42: { roll: "23KB1A0599", section: "C", branch: "CSE", year: "42" },
  43: { roll: "23KB1A0600", section: "C", branch: "CSE", year: "42" },
  44: { roll: "23KB1A0601", section: "C", branch: "CSE", year: "42" },
  46: { roll: "23KB1A0602", section: "-", branch: "CSE", year: "42" },
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
  command: vi.fn(),
  on: vi.fn(),
}));

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    api: {
      sendMessage: mocks.sendMessage,
      editMessageText: mocks.editMessageText,
      answerCallbackQuery: mocks.answerCallbackQuery,
    },
    command: mocks.command,
    on: mocks.on,
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

vi.mock("../../src/bot/authorization.js", () => ({
  isAuthorizedUser: vi.fn(async () => true),
  rememberStudent: vi.fn(async () => undefined),
}));

const { fiveQuestionView, startDailyFive } =
  await import("../../src/games/five.js");
const { createDuelFromAttempt, finishDuelAttempt, startDuel, sendDuelRecord } =
  await import("../../src/games/duel.js");
const { handleGameCallback, isGameCallback } =
  await import("../../src/games/handler.js");
const { recordAnswer, sendOrEdit } = await import("../../src/games/play.js");

type CommandHandler = (ctx: unknown) => Promise<void> | void;
const commandHandler = (name: string): CommandHandler | undefined => {
  const call = mocks.command.mock.calls.find(([command]) => command === name);
  return call?.[1] as CommandHandler | undefined;
};
const quizCommand = commandHandler("quiz");
const leagueCommand = commandHandler("league");
const duelCommand = commandHandler("duel");

const clear = async (): Promise<void> => {
  for (const table of [
    "game_questions",
    "game_rounds",
    "game_players",
    "game_attempts",
    "game_duels",
    "game_scores",
    "roll_claims",
  ]) {
    await turso.execute(`DELETE FROM ${table}`);
  }
};

const seedQuestions = async (): Promise<void> => {
  for (let index = 0; index < DAILY_POOL_SIZE; index += 1) {
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

const context = (
  userId: number,
  data: string,
  chatId = 900,
  chatType = "private",
): Context =>
  ({
    callbackQuery: {
      id: `cb-${data}`,
      from: { id: userId, is_bot: false, first_name: "Test" },
      data,
      message: {
        chat: { id: chatId, type: chatType },
        message_id: 100,
        date: 0,
      },
    },
    answerCallbackQuery: mocks.answerCallbackQuery,
  }) as unknown as Context;

const commandContext = (chatType: string) => ({
  message: {
    chat: { id: 900, type: chatType },
    from: { id: 42 },
    message_id: 9,
  },
  match: "",
});

const lastSent = () =>
  mocks.sendMessage.mock.calls.at(-1)?.[0] as
    { text?: string; chat_id?: number; reply_markup?: unknown } | undefined;

const lastEdit = () =>
  mocks.editMessageText.mock.calls.at(-1)?.[0] as
    | {
        text?: string;
        message_id?: number;
        rich_message?: { html: string };
      }
    | undefined;

/** The last edit as HTML: the rich card when it was accepted, else the text. */
const lastEditHtml = (): string => {
  const call = lastEdit();
  return call?.rich_message?.html ?? call?.text ?? "";
};

const answerAll = async (
  attemptId: number,
  userId: number,
  chatId = 900,
  wrongAt = -1,
): Promise<void> => {
  for (let index = 0; index < QUESTIONS_PER_RUN; index += 1) {
    const option = index === wrongAt ? 1 : 0;
    await handleGameCallback(
      context(userId, `q5_${attemptId}_${index}_${option}`, chatId),
    );
  }
};

beforeEach(async () => {
  await initGameTables();
  // Section boards join the claims table; this suite has no verified players.
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS roll_claims (
      roll_no TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      verified_at TEXT NOT NULL DEFAULT (datetime('now')),
      blocked INTEGER NOT NULL DEFAULT 0,
      hide_leaderboard INTEGER NOT NULL DEFAULT 0,
      block_lookups INTEGER NOT NULL DEFAULT 0,
      block_registration INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
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
  it("plays ten questions and prints the result", async () => {
    await startDailyFive({ chatId: 900, userId: 42 });

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(lastSent()?.text).toContain("Question 1 of 10");
    expect(lastSent()?.text).toContain("10s");

    const round = await getOrCreateDailyRound(istStamp().date);
    expect(round?.questionIds).toHaveLength(DAILY_POOL_SIZE);

    const attempt = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );
    expect(attempt).not.toBeNull();
    expect(attempt?.questionIds).toHaveLength(QUESTIONS_PER_RUN);
    expect(
      attempt?.questionIds.every((id) => round?.questionIds.includes(id)),
    ).toBe(true);

    await answerAll(attempt!.id, 42);

    const result = lastEditHtml();
    expect(result).toContain("Run done");
    expect(result).toContain("<table");
    expect(result).toContain("10 of 10");
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    const done = await getAttempt(attempt!.id);
    expect(done?.status).toBe("done");
    expect(done?.points).toBeGreaterThanOrEqual(1000);
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith({
      text: expect.stringContaining("Correct +"),
    });
  });

  it("makes a tap after ten seconds wrong", async () => {
    await startDailyFive({ chatId: 900, userId: 42 });
    const attempt = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );
    expect(attempt).not.toBeNull();

    const late = {
      ...attempt!,
      shownAt: new Date(Date.now() - 11_000).toISOString(),
    };
    const result = await recordAnswer({ attempt: late, index: 0, option: 0 });

    expect(result).not.toBe("stale");
    if (result === "stale") return;
    expect(result.timedOut).toBe(true);
    expect(result.correct).toBe(false);
    expect(result.earned).toBe(0);

    const saved = await getAttempt(attempt!.id);
    expect(saved?.score).toBe(0);
    expect(saved?.answers[0]).toMatchObject({ correct: false, points: 0 });
  });

  it("falls back to the text card when rich is refused", async () => {
    mocks.editMessageText.mockRejectedValueOnce(
      new Error("Bad Request: rich unsupported"),
    );

    const id = await sendOrEdit({
      chatId: 900,
      messageId: 100,
      card: {
        text: "<b>fallback</b>",
        rich: "<table><tr><td>rich</td></tr></table>",
      },
    });

    expect(id).toBe(100);
    expect(mocks.editMessageText).toHaveBeenCalledTimes(2);
    const [richCall, textCall] = mocks.editMessageText.mock.calls;
    expect(richCall[0].rich_message).toBeTruthy();
    expect(textCall[0]).toMatchObject({
      text: "<b>fallback</b>",
      parse_mode: "HTML",
    });
    expect(textCall[0].rich_message).toBeUndefined();
  });

  it("resumes the same ten instead of starting a second run", async () => {
    await startDailyFive({ chatId: 900, userId: 42 });
    const attempt = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );

    await startDailyFive({ chatId: 900, userId: 42 });

    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    expect(lastSent()?.text).toContain("Question 1 of 10");
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

    expect(lastSent()?.text).toContain("Played today. Back tomorrow.");
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
    expect(duel?.challengerScore).toBeGreaterThanOrEqual(1000);

    await startDuel({ chatId: 901, userId: 43, duelId: duel!.id });
    const duelCard = lastSent();
    expect(duelCard?.text).toContain("Duel · Question 1 of 10");
    expect(duelCard?.text).toContain("Target: <b>");

    const opponent = await getAttemptForRound("duel", `d${duel!.id}`, 43);
    expect(opponent).not.toBeNull();
    expect([...opponent!.questionIds].sort((a, b) => a - b)).toEqual(
      [...duel!.questionIds].sort((a, b) => a - b),
    );
    expect(opponent!.questionIds).not.toEqual(duel!.questionIds);

    // One wrong answer leaves the opponent below the challenger's clean run.
    await answerAll(opponent!.id, 43, 901, 0);

    const closed = await getDuel(duel!.id);
    expect(closed?.status).toBe("done");
    expect(closed?.opponentScore).toBeGreaterThanOrEqual(900);
    expect(closed?.opponentScore).toBeLessThan(duel!.challengerScore);
    expect(closed?.winnerId).toBe(42);

    expect(lastEditHtml()).toContain("Duel result");
    expect(lastEditHtml()).toContain("You");

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

const playFive = async (userId: number, chatId = 900) => {
  await startDailyFive({ chatId, userId });
  const attempt = await getAttemptForRound(
    "five",
    `five-${istStamp().date}`,
    userId,
  );
  if (!attempt) throw new Error("the Five attempt was not created");
  await answerAll(attempt.id, userId, chatId);
  const done = await getAttempt(attempt.id);
  if (!done) throw new Error("the finished Five was not read back");
  return done;
};

const makeDuel = async (userId = 42, chatId = 900) => {
  const attempt = await playFive(userId, chatId);
  await handleGameCallback(context(userId, `duel_new_${attempt.id}`, chatId));
  const duel = await getDuelByAttempt(attempt.id);
  if (!duel) throw new Error("the duel was not created");
  return { attempt, duel };
};

describe("game edge paths", () => {
  it("asks an unregistered player to save a roll", async () => {
    await startDailyFive({ chatId: 900, userId: 45 });

    expect(lastSent()?.text).toContain("Save your roll first");
  });

  it("stops when the daily question bank is empty", async () => {
    await turso.execute("UPDATE game_questions SET active = 0");

    await startDailyFive({ chatId: 900, userId: 42 });

    expect(lastSent()?.text).toContain("isn't ready");
  });

  it("finishes a run for a player without a section", async () => {
    const attempt = await playFive(46);

    expect((await getAttempt(attempt.id))?.status).toBe("done");
    expect(lastEditHtml()).toContain("No section on record");
  });

  it("still starts when the section lookup fails", async () => {
    mocks.getStudentCached.mockRejectedValueOnce(new Error("portal down"));

    await startDailyFive({ chatId: 900, userId: 42 });

    expect(lastSent()?.text).toContain("Question 1 of 10");
  });

  it("resets the section when the saved roll changes", async () => {
    await upsertGamePlayer({
      userId: 42,
      rollNo: "23KB1A0000",
      displayName: null,
      sectionKey: "4|ECE|A",
      sectionLabel: "4 ECE A",
    });

    await startDailyFive({ chatId: 900, userId: 42 });

    const player = await getGamePlayer(42);
    expect(player?.rollNo).toBe("23KB1A0599");
    expect(player?.sectionKey).toBe("4|CSE|C");
  });

  it("explains a missing duel link", async () => {
    await startDuel({ chatId: 900, userId: 43, duelId: 999999 });

    expect(lastSent()?.text).toContain("doesn't exist");
  });

  it("refuses the challenger's own duel link", async () => {
    const { duel } = await makeDuel();

    await startDuel({ chatId: 900, userId: 42, duelId: duel.id });

    expect(lastSent()?.text).toContain("your own challenge");
  });

  it("lets only the first friend claim a duel link", async () => {
    const { duel } = await makeDuel();
    await startDuel({ chatId: 901, userId: 43, duelId: duel.id });

    await startDuel({ chatId: 902, userId: 44, duelId: duel.id });

    expect(lastSent()?.text).toContain("Someone already took");
  });

  it("asks an unregistered friend to save a roll", async () => {
    const { duel } = await makeDuel();

    await startDuel({ chatId: 903, userId: 45, duelId: duel.id });

    expect(lastSent()?.text).toContain("Save your roll first");
  });

  it("expires a duel link after its window", async () => {
    const { duel } = await makeDuel();
    await turso.execute({
      sql: "UPDATE game_duels SET expires_at = ? WHERE id = ?",
      args: ["2020-01-01T00:00:00.000Z", duel.id],
    });

    await startDuel({ chatId: 901, userId: 43, duelId: duel.id });

    expect(lastSent()?.text).toContain("expired");
    expect((await getDuel(duel.id))?.status).toBe("expired");
  });

  it("resumes the opponent's question on a second tap", async () => {
    const { duel } = await makeDuel();
    await startDuel({ chatId: 901, userId: 43, duelId: duel.id });

    await startDuel({ chatId: 901, userId: 43, duelId: duel.id });

    expect(lastSent()?.text).toContain("Duel · Question 1 of 10");
  });

  it("shows a finished duel to its players only", async () => {
    const { duel } = await makeDuel();
    await startDuel({ chatId: 901, userId: 43, duelId: duel.id });
    const opponent = await getAttemptForRound("duel", `d${duel.id}`, 43);
    await answerAll(opponent!.id, 43, 901, 0);

    await startDuel({ chatId: 901, userId: 43, duelId: duel.id });
    expect(lastSent()?.text).toContain("Duel result");

    await startDuel({ chatId: 902, userId: 44, duelId: duel.id });
    expect(lastSent()?.text).toContain("already finished");
  });

  it("marks the opponent's run done when the duel closes", async () => {
    const { duel } = await makeDuel();
    await startDuel({ chatId: 901, userId: 43, duelId: duel.id });
    const opponent = await getAttemptForRound("duel", `d${duel.id}`, 43);

    await answerAll(opponent!.id, 43, 901, 0);

    const finished = await getAttempt(opponent!.id);
    expect(finished?.status).toBe("done");
    expect(finished?.finishedAt).toBeTruthy();
    expect(finished?.idx).toBe(QUESTIONS_PER_RUN);
  });

  it("requires a finished run before a challenge", async () => {
    await startDailyFive({ chatId: 900, userId: 42 });
    const attempt = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );

    await createDuelFromAttempt({ attempt: attempt!, chatId: 900 });

    expect(lastSent()?.text).toContain("Finish today's run");
  });

  it("reuses an open challenge and refuses a finished one", async () => {
    const { attempt, duel } = await makeDuel();

    await createDuelFromAttempt({ attempt, chatId: 900 });
    expect(lastSent()?.text).toContain("Challenge ready");

    await startDuel({ chatId: 901, userId: 43, duelId: duel.id });
    const opponent = await getAttemptForRound("duel", `d${duel.id}`, 43);
    await answerAll(opponent!.id, 43, 901, 0);

    await createDuelFromAttempt({ attempt, chatId: 900 });
    expect(lastSent()?.text).toContain("already finished");
  });

  it("rejects a finish with no challenge attached", async () => {
    await startDailyFive({ chatId: 900, userId: 42 });
    const attempt = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );

    await finishDuelAttempt({ attempt: attempt!, chatId: 900 });

    expect(lastSent()?.text).toContain("missing its challenge");
  });

  it("refuses the challenger's own duel attempt", async () => {
    const { duel } = await makeDuel();
    const stamp = istStamp();
    const attemptId = await createAttempt({
      game: "duel",
      roundKey: `own-${duel.id}`,
      dayKey: stamp.date,
      weekKey: stamp.week,
      season: "S1",
      userId: 42,
      rollNo: "23KB1A0599",
      sectionKey: "4|CSE|C",
      sectionLabel: "4 CSE C",
      questionIds: duel.questionIds,
      duelId: duel.id,
      startedAt: new Date().toISOString(),
    });
    const attempt = await getAttempt(attemptId);

    await finishDuelAttempt({ attempt: attempt!, chatId: 900 });

    expect(lastSent()?.text).toContain("your own challenge");
  });

  it("refuses a finish after the duel expired", async () => {
    const { duel } = await makeDuel();
    await startDuel({ chatId: 901, userId: 43, duelId: duel.id });
    const opponent = await getAttemptForRound("duel", `d${duel.id}`, 43);
    await turso.execute({
      sql: "UPDATE game_duels SET expires_at = ? WHERE id = ?",
      args: ["2020-01-01T00:00:00.000Z", duel.id],
    });
    await startDuel({ chatId: 901, userId: 43, duelId: duel.id });

    await finishDuelAttempt({ attempt: opponent!, chatId: 901 });

    expect(lastSent()?.text).toContain("expired");
  });

  it("shows the result when a finished duel is finished again", async () => {
    const { duel } = await makeDuel();
    await startDuel({ chatId: 901, userId: 43, duelId: duel.id });
    const opponent = await getAttemptForRound("duel", `d${duel.id}`, 43);
    await answerAll(opponent!.id, 43, 901, 0);

    await finishDuelAttempt({ attempt: opponent!, chatId: 901 });

    expect(lastEditHtml()).toContain("Duel result");
  });

  it("shows the duel record with no run yet", async () => {
    await sendDuelRecord({ chatId: 900, userId: 44 });

    expect(lastSent()?.text).toContain("Finish today's run");
  });

  it("starts today's run from the result button", async () => {
    await handleGameCallback(context(42, "five_play"));

    expect(lastSent()?.text).toContain("Question 1 of 10");
  });

  it("opens the weekly board from a result button", async () => {
    await handleGameCallback(context(42, "league_show"));

    expect(lastSent()?.text).toContain("Section Wars");
  });

  it("refuses another player's question card", async () => {
    await startDailyFive({ chatId: 900, userId: 42 });
    const attempt = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );

    await handleGameCallback(context(43, `q5_${attempt!.id}_0_0`, 901));

    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith({
      text: "That's not your card.",
      show_alert: true,
    });
  });

  it("shows the result when an old question is tapped", async () => {
    const attempt = await playFive(42);

    await handleGameCallback(context(42, `q5_${attempt.id}_0_0`));

    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith({
      text: "This run is already finished.",
    });
    expect(lastEditHtml()).toContain("Run done");
  });

  it("rejects a question that already moved on", async () => {
    await startDailyFive({ chatId: 900, userId: 42 });
    const attempt = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );

    await handleGameCallback(context(42, `q5_${attempt!.id}_1_0`));

    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith({
      text: "That question already moved on.",
      show_alert: true,
    });
  });

  it("rejects a stale challenge button", async () => {
    await handleGameCallback(context(42, "duel_new_999999"));

    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith({
      text: "That run is gone. Play today's run.",
      show_alert: true,
    });
  });

  it("refuses a game card in a group", async () => {
    await handleGameCallback(context(42, "five_play", 900, "group"));

    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith({
      text: "That card is private now. Open the bot to play.",
      show_alert: true,
    });
  });

  it("recognizes the game callbacks", () => {
    expect(isGameCallback("five_play")).toBe(true);
    expect(isGameCallback("league_show")).toBe(true);
    expect(isGameCallback("q5_1_0_2")).toBe(true);
    expect(isGameCallback("duel_new_12")).toBe(true);
    expect(isGameCallback("save_23KB1A0599")).toBe(false);
  });

  it("routes a group's quiz command to the private chat", async () => {
    await quizCommand!(commandContext("supergroup"));

    expect(lastSent()?.text).toContain("Today's run is private");
  });

  it("starts the quiz from a private command", async () => {
    await quizCommand!(commandContext("private"));

    expect(lastSent()?.text).toContain("Question 1 of 10");
  });

  it("routes a group's league command to the private chat", async () => {
    await leagueCommand!(commandContext("supergroup"));

    expect(lastSent()?.text).toContain("The board is in the private chat");
  });

  it("opens the weekly board from a private command", async () => {
    await leagueCommand!(commandContext("private"));

    expect(lastSent()?.text).toContain("Section Wars");
  });

  it("routes a group's duel command to the private chat", async () => {
    await duelCommand!(commandContext("supergroup"));

    expect(lastSent()?.text).toContain("Duels are private");
  });

  it("opens the duel record from a private command", async () => {
    await duelCommand!(commandContext("private"));

    expect(lastSent()?.text).toContain("Your duels");
  });
});

describe("the shared run view", () => {
  it("gives the browser the prompt and options, never the answer", async () => {
    await startDailyFive({ chatId: 900, userId: 42 });
    const attempt = await getAttemptForRound(
      "five",
      `five-${istStamp().date}`,
      42,
    );

    const view = await fiveQuestionView(attempt!);

    expect(view).toMatchObject({ index: 0, total: QUESTIONS_PER_RUN });
    expect(view?.options).toHaveLength(4);
    expect(view).not.toHaveProperty("correct");
  });
});
