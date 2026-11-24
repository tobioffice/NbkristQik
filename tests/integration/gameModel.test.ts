import { beforeEach, describe, expect, it } from "vitest";
import { turso } from "../../src/db/db.js";
import {
  addScore,
  claimDuelOpponent,
  getActiveQuestionIds,
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
  getWeekPlayerCount,
  getPlayerWeek,
  getSectionTopPlayers,
  getSectionWeek,
  getSeenQuestionIds,
  getWeekPlayers,
  getWeekSections,
  initGameTables,
  repairDuelAttempts,
  saveAnswer,
  saveChannelBoard,
  seedGameQuestions,
  setPlayerStreak,
  syncGameDisplayName,
  upsertGamePlayer,
} from "../../src/db/game.model.js";
import {
  DAILY_POOL_SIZE,
  fivePoints,
  QUESTIONS_PER_RUN,
} from "../../src/games/scoring.js";
import { pickFreshQuestionIds } from "../../src/games/selection.js";
import { STARTER_QUESTIONS } from "../../src/games/questions.js";

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
    "roll_claims",
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

const initRollClaims = async (): Promise<void> => {
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
};

/** A verified roll, as the college-email flow would have written it. */
const claim = async (rollNo: string): Promise<void> => {
  await turso.execute({
    sql: `INSERT OR IGNORE INTO roll_claims (roll_no, user_id, email)
          VALUES (?, ?, ?)`,
    args: [rollNo, `u-${rollNo}`, `${rollNo.toLowerCase()}@nbkrist.org`],
  });
};

beforeEach(async () => {
  await initGameTables();
  await initRollClaims();
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
  it("counts only each verified section's best ten players", async () => {
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

    // Section Wars counts verified students only; verify the fixture's rows.
    for (let index = 0; index < 10; index += 1) await claim(`23KB1A01${index}`);
    for (let index = 0; index < 3; index += 1) await claim(`23KB1A02${index}`);

    const board = await getWeekSections(SEASON, WEEK, 10);
    expect(board).toEqual([
      { key: "3|ECE|A", label: "3 ECE A", points: 1500, players: 3 },
      { key: "4|CSE|C", label: "4 CSE C", points: 1000, players: 10 },
    ]);

    const section = await getSectionWeek(SEASON, WEEK, "4|CSE|C");
    expect(section).toEqual({ rank: 2, total: 2, points: 1000 });
  });

  it("leaves an unverified player's points off the section board", async () => {
    await player(701);
    await addScore({
      season: SEASON,
      weekKey: WEEK,
      dayKey: DAY,
      userId: 701,
      rollNo: "23KB1A0701",
      sectionKey: "4|CSE|C",
      sectionLabel: "4 CSE C",
      source: "five",
      ref: "a701",
      points: 400,
    });
    await player(702);
    await addScore({
      season: SEASON,
      weekKey: WEEK,
      dayKey: DAY,
      userId: 702,
      rollNo: "23KB1A0702",
      sectionKey: "4|CSE|C",
      sectionLabel: "4 CSE C",
      source: "five",
      ref: "a702",
      points: 300,
    });

    // 701 proved the roll; 702 did not.
    await claim("23KB1A0701");

    expect(await getWeekSections(SEASON, WEEK, 5)).toEqual([
      { key: "4|CSE|C", label: "4 CSE C", points: 400, players: 1 },
    ]);
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

    // every finished run in the week counts as a play, including duels;
    // an active run and a run from another week do not.
    const attempt = async (userId: number, roundKey: string, done = true) =>
      turso.execute({
        sql: `INSERT INTO game_attempts
                (game, round_key, day_key, week_key, season, user_id, roll_no,
                 question_ids, status, started_at, finished_at)
              VALUES ('five', ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
        args: [
          roundKey,
          DAY,
          WEEK,
          SEASON,
          userId,
          `23KB1A03${userId - 300}`,
          done ? "done" : "active",
          "2026-11-15T03:00:00.000Z",
          done ? "2026-11-15T03:05:00.000Z" : null,
        ],
      });
    await attempt(300, "five-300-a");
    await attempt(300, "five-300-b");
    await attempt(300, "five-300-c", false);
    await turso.execute({
      sql: `INSERT INTO game_attempts
              (game, round_key, day_key, week_key, season, user_id, roll_no,
               question_ids, status, started_at, finished_at)
            VALUES ('five', 'five-300-old', ?, '2026-W45', ?, ?, ?, '[]',
                    'done', ?, ?)`,
      args: [
        "2026-11-08",
        SEASON,
        300,
        "23KB1A0300",
        "2026-11-08T03:00:00.000Z",
        "2026-11-08T03:05:00.000Z",
      ],
    });
    await attempt(301, "five-301-a");
    await turso.execute({
      sql: `INSERT INTO game_attempts
              (game, round_key, day_key, week_key, season, user_id, roll_no,
               question_ids, status, started_at, finished_at)
            VALUES ('duel', 'duel-301', ?, ?, ?, ?, ?, '[]', 'done', ?, ?)`,
      args: [
        DAY,
        WEEK,
        SEASON,
        301,
        "23KB1A0301",
        "2026-11-15T03:00:00.000Z",
        "2026-11-15T03:05:00.000Z",
      ],
    });

    const players = await getWeekPlayers(SEASON, WEEK, 5);
    expect(players.map((entry) => entry.points)).toEqual([300, 200, 100]);
    expect(players.map((entry) => entry.plays)).toEqual([2, 2, 0]);

    // the board pages without a cap; the count is the full week's field
    const secondPage = await getWeekPlayers(SEASON, WEEK, 2, 1);
    expect(secondPage.map((entry) => entry.points)).toEqual([200, 100]);
    expect(secondPage.map((entry) => entry.plays)).toEqual([2, 0]);
    expect(await getWeekPlayerCount(SEASON, WEEK)).toBe(3);

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

  it("gives the leading section's top players their week's run count", async () => {
    for (const userId of [700, 701]) {
      const rollNo = `23KB1A070${userId - 700}`;
      await player(userId);
      await addScore({
        season: SEASON,
        weekKey: WEEK,
        dayKey: DAY,
        userId,
        rollNo,
        sectionKey: "4|CSE|C",
        sectionLabel: "4 CSE C",
        source: "five",
        ref: `a${userId}`,
        points: userId === 700 ? 240 : 120,
      });
      await claim(rollNo);
    }

    const attempt = async (userId: number, roundKey: string, game = "five") =>
      turso.execute({
        sql: `INSERT INTO game_attempts
                (game, round_key, day_key, week_key, season, user_id, roll_no,
                 question_ids, status, started_at, finished_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'done', ?, ?)`,
        args: [
          game,
          roundKey,
          DAY,
          WEEK,
          SEASON,
          userId,
          `23KB1A070${userId - 700}`,
          "2026-11-15T03:00:00.000Z",
          "2026-11-15T03:05:00.000Z",
        ],
      });
    await attempt(700, "five-700-a");
    await attempt(700, "duel-700", "duel");
    await attempt(701, "five-701-a");

    const top = await getSectionTopPlayers(SEASON, WEEK, "4|CSE|C", 3);
    expect(
      top.map((entry) => [entry.rollNo, entry.points, entry.plays]),
    ).toEqual([
      ["23KB1A0700", 240, 2],
      ["23KB1A0701", 120, 1],
    ]);
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

describe("question history", () => {
  const seedQuestion = async (id: number, active = 1): Promise<void> => {
    await turso.execute({
      sql: `INSERT INTO game_questions
              (id, slug, prompt, options, correct, topic, active)
            VALUES (?, ?, ?, ?, 0, 'test', ?)`,
      args: [id, `hist-${id}`, `Prompt ${id}`, '["A","B","C","D"]', active],
    });
  };

  const seedAttempt = async (
    userId: number,
    game: string,
    roundKey: string,
    questionIds: number[],
    startedAt: string,
    status = "done",
  ): Promise<void> => {
    await turso.execute({
      sql: `INSERT INTO game_attempts
              (game, round_key, day_key, week_key, season, user_id, roll_no,
               question_ids, status, started_at, finished_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        game,
        roundKey,
        DAY,
        WEEK,
        SEASON,
        userId,
        "23KB1A0999",
        JSON.stringify(questionIds),
        status,
        startedAt,
        status === "done" ? startedAt : null,
      ],
    });
  };

  it("lists the player's questions newest first, duel runs included", async () => {
    for (const id of [1, 2, 3, 4, 5]) await seedQuestion(id);

    await seedAttempt(900, "five", "r1", [1, 2], "2026-11-22T03:00:00.000Z");
    await seedAttempt(900, "duel", "d1", [3], "2026-11-22T04:00:00.000Z");
    await seedAttempt(900, "five", "r2", [4, 5], "2026-11-23T03:00:00.000Z");
    await seedAttempt(
      900,
      "five",
      "r3",
      [1],
      "2026-11-24T03:00:00.000Z",
      "active",
    );

    // newest run first, first sighting only; the duel run counts too
    expect(await getSeenQuestionIds(900)).toEqual([1, 4, 5, 3, 2]);
    expect(await getSeenQuestionIds(901)).toEqual([]);
  });

  it("offers only active questions to the bank fill", async () => {
    await seedQuestion(1);
    await seedQuestion(2, 0);
    await seedQuestion(3);

    expect(await getActiveQuestionIds()).toEqual([1, 3]);
  });

  it("keeps a second run's set clear of the first run's questions", async () => {
    const bankIds = Array.from({ length: 60 }, (_, index) => index + 1);
    for (const id of bankIds) await seedQuestion(id);
    await seedAttempt(
      901,
      "five",
      "first",
      [1, 2, 3],
      "2026-11-22T03:00:00.000Z",
    );

    const history = await getSeenQuestionIds(901);
    const fresh = pickFreshQuestionIds({
      pool: Array.from({ length: 30 }, (_, index) => index + 1),
      bank: await getActiveQuestionIds(),
      seen: history,
      count: 10,
    });

    expect(fresh.repeated).toEqual([]);
    expect(fresh.ids).toHaveLength(10);
    expect(fresh.ids.some((id) => history.includes(id))).toBe(false);
  });
});

describe("the seeded bank", () => {
  it("seeds every starter question once with four distinct options", async () => {
    await seedGameQuestions();

    const count = await turso.execute(
      "SELECT COUNT(*) AS n FROM game_questions",
    );
    expect(Number(count.rows[0]?.n)).toBe(STARTER_QUESTIONS.length);
    // a player's daily run needs ten fresh questions a day; keep the bank deep
    expect(STARTER_QUESTIONS.length).toBeGreaterThanOrEqual(200);

    const slugs = STARTER_QUESTIONS.map((question) => question.slug);
    const prompts = STARTER_QUESTIONS.map((question) => question.prompt);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(prompts).size).toBe(prompts.length);

    for (const question of STARTER_QUESTIONS) {
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options).size).toBe(4);
      expect(question.correct).toBeGreaterThanOrEqual(0);
      expect(question.correct).toBeLessThan(4);
    }
  });
});

describe("the duel attempt repair", () => {
  it("closes a finished duel's run that was left active", async () => {
    const finishedAt = "2026-11-15T04:00:00.000Z";
    const duelId = await createDuel({
      challengerId: 903,
      challengerRoll: "23KB1A0903",
      challengerName: null,
      challengerSectionKey: "4|CSE|C",
      challengerSectionLabel: "4 CSE C",
      challengerScore: 600,
      challengerAttemptId: 9999,
      questionIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      dayKey: DAY,
      weekKey: WEEK,
      season: SEASON,
      expiresAt: "2026-11-17T03:00:00.000Z",
    });
    const attemptId = await createAttempt({
      game: "duel",
      roundKey: "d-repair",
      dayKey: DAY,
      weekKey: WEEK,
      season: SEASON,
      userId: 902,
      rollNo: "23KB1A0902",
      sectionKey: "4|CSE|C",
      sectionLabel: "4 CSE C",
      questionIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      duelId,
      startedAt: "2026-11-15T03:00:00.000Z",
    });
    await finishDuel({
      id: duelId,
      opponentId: 902,
      opponentRoll: "23KB1A0902",
      opponentName: null,
      opponentScore: 300,
      winnerId: 903,
      finishedAt,
    });

    expect(await repairDuelAttempts()).toBe(1);
    const repaired = await getAttempt(attemptId);
    expect(repaired).toMatchObject({ status: "done", finishedAt, idx: 10 });
    // a second boot finds nothing left to repair
    expect(await repairDuelAttempts()).toBe(0);
  });
});
