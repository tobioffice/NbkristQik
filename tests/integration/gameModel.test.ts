import { beforeEach, describe, expect, it } from "vitest";
import { turso } from "../../src/db/db.js";
import {
  addScore,
  claimDuelOpponent,
  createAttempt,
  createDuel,
  finishAttempt,
  finishDuel,
  getAttempt,
  getChannelBoard,
  getDuel,
  getDuelByAttempt,
  getDuelRecord,
  getFiveRank,
  getGamePlayer,
  getOrCreateDailyRound,
  getPlayerWeek,
  getSectionWeek,
  getWeekPlayers,
  getWeekSections,
  initGameTables,
  saveAnswer,
  saveChannelBoard,
  setPlayerStreak,
  syncGameDisplayName,
  upsertGamePlayer,
} from "../../src/db/game.model.js";
import {
  DAILY_POOL_SIZE,
  fivePoints,
  QUESTIONS_PER_RUN,
} from "../../src/games/scoring.js";

const SEASON = "test-S1";
const WEEK = "2026-W46";
const DAY = "2026-11-15";

const clear = async (): Promise<void> => {
  for (const table of [
    "game_questions",
    "game_rounds",
    "game_players",
    "game_attempts",
    "game_duels",
    "game_scores",
    "game_channel_board",
  ]) {
    await turso.execute(`DELETE FROM ${table}`);
  }
};

const question = async (slug: string): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO game_questions (slug, prompt, options, correct, topic)
          VALUES (?, ?, ?, 0, 'test')`,
    args: [slug, `Prompt ${slug}`, JSON.stringify(["A", "B", "C", "D"])],
  });
};

const player = async (
  userId: number,
  sectionKey: string | null = "4|CSE|C",
  sectionLabel: string | null = "4 CSE C",
): Promise<void> => {
  await upsertGamePlayer({
    userId,
    rollNo: `23KB1A${String(userId).padStart(4, "0")}`,
    displayName: null,
    sectionKey,
    sectionLabel,
  });
};

beforeEach(async () => {
  await initGameTables();
  await clear();
});

describe("daily rounds", () => {
  it("picks one large pool and returns it to later callers", async () => {
    for (let index = 0; index < DAILY_POOL_SIZE; index += 1) {
      await question(`pool-${index}`);
    }

    const first = await getOrCreateDailyRound(DAY);
    const second = await getOrCreateDailyRound(DAY);

    expect(first).not.toBeNull();
    expect(first?.id).toBe(`five-${DAY}`);
    expect(first?.questionIds).toHaveLength(DAILY_POOL_SIZE);
    expect(second?.questionIds).toEqual(first?.questionIds);
  });

  it("returns null when the bank cannot fill one run", async () => {
    for (let index = 0; index < QUESTIONS_PER_RUN - 1; index += 1) {
      await question(`short-${index}`);
    }
    expect(await getOrCreateDailyRound(DAY)).toBeNull();
  });
});

describe("attempts", () => {
  const newAttempt = () => ({
    game: "five" as const,
    roundKey: `five-${DAY}`,
    dayKey: DAY,
    weekKey: WEEK,
    season: SEASON,
    userId: 21,
    rollNo: "23KB1A0021",
    sectionKey: "4|CSE|C",
    sectionLabel: "4 CSE C",
    questionIds: Array.from(
      { length: QUESTIONS_PER_RUN },
      (_, index) => index + 1,
    ),
    startedAt: "2026-11-15T03:00:00.000Z",
  });

  it("creates once per round and resumes the same row", async () => {
    const first = await createAttempt(newAttempt());
    const second = await createAttempt(newAttempt());

    expect(second).toBe(first);
  });

  it("records an answer once and rejects a second tap on the same index", async () => {
    const id = await createAttempt(newAttempt());

    const saved = await saveAnswer({
      id,
      index: 0,
      answers: [{ option: 0, correct: true, ms: 1200, points: 147 }],
      score: 147,
    });
    const again = await saveAnswer({
      id,
      index: 0,
      answers: [{ option: 0, correct: true, ms: 100, points: 150 }],
      score: 150,
    });

    expect(saved).toBe(true);
    expect(again).toBe(false);

    const attempt = await getAttempt(id);
    expect(attempt?.idx).toBe(1);
    expect(attempt?.score).toBe(147);
    expect(attempt?.answers).toHaveLength(1);
  });

  it("finishes once and pays once", async () => {
    const id = await createAttempt(newAttempt());
    const finishedAt = "2026-11-15T03:02:00.000Z";

    const first = await finishAttempt({
      id,
      score: 612,
      points: fivePoints(612, 1),
      streak: 1,
      questionCount: QUESTIONS_PER_RUN,
      finishedAt,
    });
    const second = await finishAttempt({
      id,
      score: 612,
      points: 999,
      streak: 1,
      questionCount: QUESTIONS_PER_RUN,
      finishedAt,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);

    const attempt = await getAttempt(id);
    expect(attempt?.status).toBe("done");
    expect(attempt?.idx).toBe(QUESTIONS_PER_RUN);
    expect(attempt?.points).toBe(612);

    const award = {
      season: SEASON,
      weekKey: WEEK,
      dayKey: DAY,
      userId: 21,
      rollNo: "23KB1A0021",
      sectionKey: "4|CSE|C",
      sectionLabel: "4 CSE C",
      source: "five" as const,
      ref: `a${id}`,
      points: 612,
    };
    expect(await addScore(award)).toBe(true);
    expect(await addScore(award)).toBe(false);
  });

  it("ranks a day by score, then by the earlier finish", async () => {
    const ids: number[] = [];
    for (const userId of [31, 32, 33]) {
      ids.push(
        await createAttempt({
          ...newAttempt(),
          userId,
          rollNo: `23KB1A00${userId}`,
        }),
      );
    }

    await finishAttempt({
      id: ids[0]!,
      score: 600,
      points: 600,
      streak: 1,
      questionCount: QUESTIONS_PER_RUN,
      finishedAt: "2026-11-15T03:01:00.000Z",
    });
    await finishAttempt({
      id: ids[1]!,
      score: 700,
      points: 700,
      streak: 1,
      questionCount: QUESTIONS_PER_RUN,
      finishedAt: "2026-11-15T03:02:00.000Z",
    });
    await finishAttempt({
      id: ids[2]!,
      score: 700,
      points: 700,
      streak: 1,
      questionCount: QUESTIONS_PER_RUN,
      finishedAt: "2026-11-15T03:03:00.000Z",
    });

    const rank = await getFiveRank({
      dayKey: DAY,
      points: 600,
      finishedAt: "2026-11-15T03:01:00.000Z",
    });
    expect(rank).toEqual({ rank: 3, total: 3 });

    const runnerUp = await getFiveRank({
      dayKey: DAY,
      points: 700,
      finishedAt: "2026-11-15T03:03:00.000Z",
    });
    expect(runnerUp.rank).toBe(2);

    const leader = await getFiveRank({
      dayKey: DAY,
      points: 700,
      finishedAt: "2026-11-15T03:02:00.000Z",
    });
    expect(leader.rank).toBe(1);
  });
});

describe("weekly boards", () => {
  it("counts only each section's best ten players", async () => {
    // Section A has twelve players on 100 each: only ten count, 1,000.
    for (let index = 0; index < 12; index += 1) {
      const userId = 100 + index;
      await player(userId);
      await addScore({
        season: SEASON,
        weekKey: WEEK,
        dayKey: DAY,
        userId,
        rollNo: `23KB1A01${index}`,
        sectionKey: "4|CSE|C",
        sectionLabel: "4 CSE C",
        source: "five",
        ref: `a${userId}`,
        points: 100,
      });
    }

    // Section B has three players on 500 each: 1,500 wins with fewer people.
    for (let index = 0; index < 3; index += 1) {
      const userId = 200 + index;
      await player(userId, "3|ECE|A", "3 ECE A");
      await addScore({
        season: SEASON,
        weekKey: WEEK,
        dayKey: DAY,
        userId,
        rollNo: `23KB1A02${index}`,
        sectionKey: "3|ECE|A",
        sectionLabel: "3 ECE A",
        source: "five",
        ref: `a${userId}`,
        points: 500,
      });
    }

    const board = await getWeekSections(SEASON, WEEK, 10);
    expect(board).toEqual([
      { key: "3|ECE|A", label: "3 ECE A", points: 1500, players: 3 },
      { key: "4|CSE|C", label: "4 CSE C", points: 1000, players: 10 },
    ]);

    const section = await getSectionWeek(SEASON, WEEK, "4|CSE|C");
    expect(section).toEqual({ rank: 2, total: 2, points: 1000 });
  });

  it("ranks players and reports how many played", async () => {
    for (let index = 0; index < 3; index += 1) {
      const userId = 300 + index;
      await player(userId);
      await addScore({
        season: SEASON,
        weekKey: WEEK,
        dayKey: DAY,
        userId,
        rollNo: `23KB1A03${index}`,
        sectionKey: "4|CSE|C",
        sectionLabel: "4 CSE C",
        source: "five",
        ref: `a${userId}`,
        points: 100 * (3 - index),
      });
    }

    const players = await getWeekPlayers(SEASON, WEEK, 5);
    expect(players.map((entry) => entry.points)).toEqual([300, 200, 100]);

    expect(await getPlayerWeek(SEASON, WEEK, 301)).toEqual({
      points: 200,
      rank: 2,
      players: 3,
    });
    expect(await getPlayerWeek(SEASON, WEEK, 999)).toEqual({
      points: 0,
      rank: null,
      players: 3,
    });
  });
});

describe("players", () => {
  it("keeps the section on a refresh that has no section", async () => {
    await player(501);
    await player(501, null, null);
    const stored = await getGamePlayer(501);
    expect(stored?.sectionKey).toBe("4|CSE|C");
  });

  it("clears a public name when the profile clears it", async () => {
    await upsertGamePlayer({
      userId: 503,
      rollNo: "23KB1A0503",
      displayName: "Asha",
      sectionKey: "4|CSE|C",
      sectionLabel: "4 CSE C",
    });
    expect((await getGamePlayer(503))?.displayName).toBe("Asha");

    await syncGameDisplayName(503, null);
    expect((await getGamePlayer(503))?.displayName).toBeNull();
  });

  it("updates the streak", async () => {
    await player(502);
    await setPlayerStreak({
      userId: 502,
      streak: 3,
      bestStreak: 4,
      lastFive: DAY,
    });
    const stored = await getGamePlayer(502);
    expect(stored?.streak).toBe(3);
    expect(stored?.bestStreak).toBe(4);
    expect(stored?.lastFive).toBe(DAY);
  });
});

describe("duels", () => {
  const newDuel = () => ({
    challengerId: 601,
    challengerRoll: "23KB1A0601",
    challengerName: null,
    challengerSectionKey: "4|CSE|C",
    challengerSectionLabel: "4 CSE C",
    challengerScore: 612,
    challengerAttemptId: 9001,
    questionIds: [1, 2, 3, 4, 5],
    dayKey: DAY,
    weekKey: WEEK,
    season: SEASON,
    expiresAt: "2026-11-17T03:00:00.000Z",
  });

  it("lets exactly one opponent claim a shared link", async () => {
    const id = await createDuel(newDuel());

    expect(
      await claimDuelOpponent({
        duelId: id,
        userId: 602,
        rollNo: "23KB1A0602",
        displayName: null,
      }),
    ).toBe(true);
    expect(
      await claimDuelOpponent({
        duelId: id,
        userId: 603,
        rollNo: "23KB1A0603",
        displayName: null,
      }),
    ).toBe(false);

    const duel = await getDuel(id);
    expect(duel?.opponentId).toBe(602);
    expect(duel?.opponentRoll).toBe("23KB1A0602");
  });

  it("creates once per attempt and closes once", async () => {
    const first = await createDuel(newDuel());
    const second = await createDuel(newDuel());
    expect(second).toBe(first);

    const stored = await getDuelByAttempt(9001);
    expect(stored?.id).toBe(first);
    expect(stored?.status).toBe("open");

    const closed = await finishDuel({
      id: first,
      opponentId: 602,
      opponentRoll: "23KB1A0602",
      opponentName: null,
      opponentScore: 700,
      winnerId: 602,
      finishedAt: "2026-11-15T04:00:00.000Z",
    });
    const again = await finishDuel({
      id: first,
      opponentId: 602,
      opponentRoll: "23KB1A0602",
      opponentName: null,
      opponentScore: 700,
      winnerId: 602,
      finishedAt: "2026-11-15T04:00:00.000Z",
    });

    expect(closed).toBe(true);
    expect(again).toBe(false);

    const duel = await getDuel(first);
    expect(duel?.status).toBe("done");
    expect(duel?.opponentScore).toBe(700);
    expect(duel?.winnerId).toBe(602);
  });

  it("counts wins, losses and draws from both sides", async () => {
    const first = await createDuel(newDuel());
    await finishDuel({
      id: first,
      opponentId: 602,
      opponentRoll: "23KB1A0602",
      opponentName: null,
      opponentScore: 500,
      winnerId: 601,
      finishedAt: "2026-11-15T04:00:00.000Z",
    });

    const second = await createDuel({
      ...newDuel(),
      challengerId: 603,
      challengerRoll: "23KB1A0603",
      challengerAttemptId: 9002,
    });
    await finishDuel({
      id: second,
      opponentId: 601,
      opponentRoll: "23KB1A0601",
      opponentName: null,
      opponentScore: 601,
      winnerId: null,
      finishedAt: "2026-11-15T04:10:00.000Z",
    });

    expect(await getDuelRecord(601)).toEqual({
      wins: 1,
      losses: 0,
      draws: 1,
    });
    expect(await getDuelRecord(602)).toEqual({
      wins: 0,
      losses: 1,
      draws: 0,
    });
  });
});

describe("the channel live board", () => {
  it("remembers the message and the fingerprint", async () => {
    await saveChannelBoard({
      slot: "live",
      chatId: "@test_channel",
      messageId: 77,
      snapshot: "first",
      updatedAt: "2026-11-15T10:00:00.000Z",
    });
    expect(await getChannelBoard("live")).toEqual({
      chatId: "@test_channel",
      messageId: 77,
      snapshot: "first",
      updatedAt: "2026-11-15T10:00:00.000Z",
    });
  });

  it("overwrites the same slot on the next change", async () => {
    await saveChannelBoard({
      slot: "live",
      chatId: "@test_channel",
      messageId: 77,
      snapshot: "first",
      updatedAt: "2026-11-15T10:00:00.000Z",
    });
    await saveChannelBoard({
      slot: "live",
      chatId: "@test_channel",
      messageId: 78,
      snapshot: "second",
      updatedAt: "2026-11-15T10:05:00.000Z",
    });

    expect(await getChannelBoard("live")).toMatchObject({
      messageId: 78,
      snapshot: "second",
    });
  });

  it("has no row before the first post", async () => {
    expect(await getChannelBoard("missing")).toBeNull();
  });
});
