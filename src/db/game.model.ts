import { turso } from "./db.js";
import { logger } from "../config/logger.js";
import { STARTER_QUESTIONS } from "../games/questions.js";
import { DAILY_POOL_SIZE, QUESTIONS_PER_RUN } from "../games/scoring.js";
import type {
  AttemptAnswer,
  BoardPlayer,
  BoardSection,
  GameAttempt,
  GameDuel,
  GameKind,
  GamePlayer,
  GameQuestion,
} from "../games/types.js";

/**
 * The league store.
 *
 * One row per finished attempt is not enough: a player answers one question at
 * a time, and a restart in the middle must resume where they stopped. The
 * attempt row is therefore the live game, updated with a conditional `idx`
 * check so two fast taps cannot record the same question twice.
 *
 * Season points live in `game_scores`, one row per award, with a unique key on
 * (source, ref, user_id). A retry or a double callback cannot pay twice. Only
 * a finished daily run awards points; a duel is a match, not a run, so duel
 * awards are excluded from every leaderboard read (and none are written any
 * more, but old weeks may still hold some).
 */

const num = (value: unknown): number => Number(value ?? 0);

const text = (value: unknown): string => String(value ?? "");

const nullableText = (value: unknown): string | null =>
  value == null ? null : String(value);

const jsonArray = <T>(raw: unknown, fallback: T[]): T[] => {
  try {
    const parsed: unknown = JSON.parse(text(raw) || "null");
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
};

export const initGameTables = async (): Promise<void> => {
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS game_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE,
      prompt TEXT NOT NULL,
      options TEXT NOT NULL,
      correct INTEGER NOT NULL,
      topic TEXT NOT NULL DEFAULT 'general',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS game_rounds (
      id TEXT PRIMARY KEY,
      game TEXT NOT NULL,
      day_key TEXT NOT NULL,
      question_ids TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS game_players (
      user_id INTEGER PRIMARY KEY,
      roll_no TEXT NOT NULL,
      display_name TEXT,
      section_key TEXT,
      section_label TEXT,
      streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      last_five TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS game_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game TEXT NOT NULL,
      round_key TEXT NOT NULL,
      day_key TEXT NOT NULL,
      week_key TEXT NOT NULL,
      season TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      roll_no TEXT NOT NULL,
      section_key TEXT,
      section_label TEXT,
      question_ids TEXT NOT NULL,
      answers TEXT NOT NULL DEFAULT '[]',
      idx INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      duel_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL,
      shown_at TEXT,
      finished_at TEXT,
      UNIQUE(game, round_key, user_id)
    );
  `);
  await turso.execute(`
    CREATE INDEX IF NOT EXISTS idx_game_attempts_day
      ON game_attempts (game, day_key, status, score);
  `);
  await turso.execute(`
    CREATE INDEX IF NOT EXISTS idx_game_attempts_user
      ON game_attempts (user_id, game, day_key);
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS game_duels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenger_id INTEGER NOT NULL,
      challenger_roll TEXT NOT NULL,
      challenger_name TEXT,
      challenger_section_key TEXT,
      challenger_section_label TEXT,
      challenger_score INTEGER NOT NULL,
      challenger_attempt_id INTEGER NOT NULL,
      question_ids TEXT NOT NULL,
      day_key TEXT NOT NULL,
      week_key TEXT NOT NULL,
      season TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      opponent_id INTEGER,
      opponent_roll TEXT,
      opponent_name TEXT,
      opponent_score INTEGER,
      winner_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      expires_at TEXT NOT NULL
    );
  `);
  await turso.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_game_duels_attempt
      ON game_duels (challenger_attempt_id);
  `);
  await turso.execute(`
    CREATE INDEX IF NOT EXISTS idx_game_duels_open
      ON game_duels (status, expires_at);
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS game_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season TEXT NOT NULL,
      week_key TEXT NOT NULL,
      day_key TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      roll_no TEXT NOT NULL,
      section_key TEXT,
      section_label TEXT,
      source TEXT NOT NULL,
      ref TEXT NOT NULL,
      points INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_game_scores_once
      ON game_scores (source, ref, user_id);
  `);
  await turso.execute(`
    CREATE INDEX IF NOT EXISTS idx_game_scores_section
      ON game_scores (season, week_key, section_key);
  `);
  await turso.execute(`
    CREATE INDEX IF NOT EXISTS idx_game_scores_user
      ON game_scores (season, week_key, user_id);
  `);
  // The channel's live board reads the current IST day every minute.
  await turso.execute(`
    CREATE INDEX IF NOT EXISTS idx_game_scores_day
      ON game_scores (day_key, source);
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS game_channel_board (
      slot TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
};

/**
 * Insert the starter bank once. The slug is the identity, so a restart, a
 * second process or an edited question never duplicates a row. Admin-added
 * questions have no slug and are untouched.
 */
export const seedGameQuestions = async (): Promise<void> => {
  const statements = STARTER_QUESTIONS.map((question) => ({
    sql: `INSERT OR IGNORE INTO game_questions
            (slug, prompt, options, correct, topic)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      question.slug,
      question.prompt,
      JSON.stringify(question.options),
      question.correct,
      question.topic,
    ] as (string | number)[],
  }));

  // One batch instead of a round trip per question: a remote Turso boot should
  // not pay a network hop per starter row.
  await turso.batch(statements, "write");
  logger.info(
    `[games] question bank ready (${STARTER_QUESTIONS.length} starter rows)`,
  );
};

const questionFromRow = (row: Record<string, unknown>): GameQuestion => ({
  id: num(row.id),
  prompt: text(row.prompt),
  options: jsonArray<string>(row.options, []),
  correct: num(row.correct),
  topic: text(row.topic),
});

/** `count` random active questions, in random order. */
export const getRandomQuestions = async (
  count: number,
): Promise<GameQuestion[]> => {
  const limit = Math.max(1, Math.min(200, Math.floor(count)));
  const result = await turso.execute({
    sql: `SELECT id, prompt, options, correct, topic
          FROM game_questions
          WHERE active = 1
          ORDER BY RANDOM()
          LIMIT ?`,
    args: [limit],
  });
  return result.rows.map((row) => questionFromRow(row));
};

/** Every active question id, for a fresh run's unseen-question fill. */
export const getActiveQuestionIds = async (): Promise<number[]> => {
  const result = await turso.execute({
    sql: `SELECT id FROM game_questions WHERE active = 1`,
  });
  return result.rows.map((row) => num(row.id));
};

/**
 * The questions this player has already been shown, most recently seen first.
 *
 * Every attempt is history: a daily run stores its ten whether it finished or
 * not, and a duel replays the challenger's paper, so the opponent has seen
 * those questions too. The order lets an exhausted bank reuse the questions
 * seen longest ago.
 */
export const getSeenQuestionIds = async (userId: number): Promise<number[]> => {
  const result = await turso.execute({
    sql: `SELECT question_ids FROM game_attempts
          WHERE user_id = ?
          ORDER BY started_at DESC, id DESC`,
    args: [userId],
  });
  const newestFirst: number[] = [];
  const seen = new Set<number>();
  for (const row of result.rows) {
    for (const id of jsonArray<number>(row.question_ids, [])) {
      if (seen.has(id)) continue;
      seen.add(id);
      newestFirst.push(id);
    }
  }
  return newestFirst;
};

/** Questions by id, returned in the order of `ids`. */
export const getQuestionsByIds = async (
  ids: number[],
): Promise<GameQuestion[]> => {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const result = await turso.execute({
    sql: `SELECT id, prompt, options, correct, topic
          FROM game_questions
          WHERE id IN (${placeholders})`,
    args: ids,
  });
  const byId = new Map(
    result.rows.map((row) => {
      const question = questionFromRow(row);
      return [question.id, question] as const;
    }),
  );
  return ids
    .map((id) => byId.get(id))
    .filter((question): question is GameQuestion => Boolean(question));
};

interface RoundRow {
  id: string;
  game: string;
  dayKey: string;
  questionIds: number[];
}

const roundFromRow = (row: Record<string, unknown>): RoundRow => ({
  id: text(row.id),
  game: text(row.game),
  dayKey: text(row.day_key),
  questionIds: jsonArray<number>(row.question_ids, []),
});

export const getRound = async (id: string): Promise<RoundRow | null> => {
  const result = await turso.execute({
    sql: `SELECT id, game, day_key, question_ids FROM game_rounds WHERE id = ?`,
    args: [id],
  });
  return result.rows[0] ? roundFromRow(result.rows[0]) : null;
};

/**
 * Today's question pool, created on the first play.
 *
 * The pool is larger than one run. Every attempt draws its own ten from it,
 * so students do not all sit the same paper. A simultaneous first caller
 * loses the `INSERT OR IGNORE` race and reads the winner's pool.
 *
 * An older round may hold only the five IDs from before the pool existed.
 * Replace it once the bank can fill a larger pool; attempts already in
 * progress keep their own stored IDs either way.
 */
export const getOrCreateDailyRound = async (
  dayKey: string,
): Promise<RoundRow | null> => {
  const id = `five-${dayKey}`;
  const existing = await getRound(id);
  if (existing && existing.questionIds.length >= DAILY_POOL_SIZE) {
    return existing;
  }

  const questions = await getRandomQuestions(DAILY_POOL_SIZE);
  if (questions.length < QUESTIONS_PER_RUN) return null;

  const questionIds = questions.map((question) => question.id);

  if (existing) {
    if (existing.questionIds.length >= questionIds.length) return existing;

    await turso.execute({
      sql: `UPDATE game_rounds SET question_ids = ? WHERE id = ?`,
      args: [JSON.stringify(questionIds), id],
    });
    return getRound(id);
  }

  await turso.execute({
    sql: `INSERT OR IGNORE INTO game_rounds (id, game, day_key, question_ids)
          VALUES (?, 'five', ?, ?)`,
    args: [id, dayKey, JSON.stringify(questionIds)],
  });
  return getRound(id);
};

export interface PlayerIdentity {
  userId: number;
  rollNo: string;
  displayName: string | null;
  sectionKey: string | null;
  sectionLabel: string | null;
}

/**
 * Remember who plays for which section.
 *
 * A later refresh that has no section (the college list hiccuped) must not
 * erase the section the player already earned points under.
 */
export const upsertGamePlayer = async (
  player: PlayerIdentity,
): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO game_players
            (user_id, roll_no, display_name, section_key, section_label)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            roll_no = excluded.roll_no,
            display_name = excluded.display_name,
            section_key = CASE
              WHEN game_players.roll_no != excluded.roll_no
              THEN excluded.section_key
              ELSE COALESCE(excluded.section_key, game_players.section_key)
            END,
            section_label = CASE
              WHEN game_players.roll_no != excluded.roll_no
              THEN excluded.section_label
              ELSE COALESCE(excluded.section_label, game_players.section_label)
            END,
            updated_at = datetime('now')`,
    args: [
      player.userId,
      player.rollNo.toUpperCase(),
      player.displayName,
      player.sectionKey,
      player.sectionLabel,
    ],
  });
};

const playerFromRow = (row: Record<string, unknown>): GamePlayer => ({
  userId: num(row.user_id),
  rollNo: text(row.roll_no),
  displayName: nullableText(row.display_name),
  sectionKey: nullableText(row.section_key),
  sectionLabel: nullableText(row.section_label),
  streak: num(row.streak),
  bestStreak: num(row.best_streak),
  lastFive: nullableText(row.last_five),
});

export const getGamePlayer = async (
  userId: number,
): Promise<GamePlayer | null> => {
  const result = await turso.execute({
    sql: `SELECT user_id, roll_no, display_name, section_key, section_label,
                 streak, best_streak, last_five
          FROM game_players WHERE user_id = ?`,
    args: [userId],
  });
  return result.rows[0] ? playerFromRow(result.rows[0]) : null;
};

/**
 * Keep the public name in step with the profile.
 *
 * The board joins this row; a student who clears their display name must
 * become a masked roll on the next post, even if they do not play again.
 */
export const syncGameDisplayName = async (
  userId: number,
  displayName: string | null,
): Promise<void> => {
  await turso.execute({
    sql: `UPDATE game_players
          SET display_name = ?, updated_at = datetime('now')
          WHERE user_id = ?`,
    args: [displayName, userId],
  });
};

export const setPlayerStreak = async (input: {
  userId: number;
  streak: number;
  bestStreak: number;
  lastFive: string;
}): Promise<void> => {
  await turso.execute({
    sql: `UPDATE game_players
          SET streak = ?, best_streak = ?, last_five = ?,
              updated_at = datetime('now')
          WHERE user_id = ?`,
    args: [input.streak, input.bestStreak, input.lastFive, input.userId],
  });
};

export interface NewAttempt {
  game: GameKind;
  roundKey: string;
  dayKey: string;
  weekKey: string;
  season: string;
  userId: number;
  rollNo: string;
  sectionKey: string | null;
  sectionLabel: string | null;
  questionIds: number[];
  duelId?: number | null;
  startedAt: string;
}

export const createAttempt = async (attempt: NewAttempt): Promise<number> => {
  const result = await turso.execute({
    sql: `INSERT OR IGNORE INTO game_attempts
            (game, round_key, day_key, week_key, season, user_id, roll_no,
             section_key, section_label, question_ids, duel_id, started_at, shown_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      attempt.game,
      attempt.roundKey,
      attempt.dayKey,
      attempt.weekKey,
      attempt.season,
      attempt.userId,
      attempt.rollNo.toUpperCase(),
      attempt.sectionKey,
      attempt.sectionLabel,
      JSON.stringify(attempt.questionIds),
      attempt.duelId ?? null,
      attempt.startedAt,
      attempt.startedAt,
    ],
  });

  if (Number(result.rowsAffected) === 1) {
    return Number(result.lastInsertRowid);
  }

  const existing = await getAttemptForRound(
    attempt.game,
    attempt.roundKey,
    attempt.userId,
  );
  if (!existing) {
    throw new Error("game attempt could not be created");
  }
  return existing.id;
};

const attemptFromRow = (row: Record<string, unknown>): GameAttempt => ({
  id: num(row.id),
  game: text(row.game) === "duel" ? "duel" : "five",
  roundKey: text(row.round_key),
  dayKey: text(row.day_key),
  weekKey: text(row.week_key),
  season: text(row.season),
  userId: num(row.user_id),
  rollNo: text(row.roll_no),
  sectionKey: nullableText(row.section_key),
  sectionLabel: nullableText(row.section_label),
  questionIds: jsonArray<number>(row.question_ids, []),
  answers: jsonArray<AttemptAnswer>(row.answers, []),
  idx: num(row.idx),
  score: num(row.score),
  points: num(row.points),
  streak: num(row.streak),
  duelId: row.duel_id == null ? null : num(row.duel_id),
  status: text(row.status) === "done" ? "done" : "active",
  startedAt: text(row.started_at),
  shownAt: nullableText(row.shown_at),
  finishedAt: nullableText(row.finished_at),
});

const ATTEMPT_COLUMNS = `id, game, round_key, day_key, week_key, season, user_id,
  roll_no, section_key, section_label, question_ids, answers, idx, score,
  points, streak, duel_id, status, started_at, shown_at, finished_at`;

export const getAttempt = async (id: number): Promise<GameAttempt | null> => {
  const result = await turso.execute({
    sql: `SELECT ${ATTEMPT_COLUMNS} FROM game_attempts WHERE id = ?`,
    args: [id],
  });
  return result.rows[0] ? attemptFromRow(result.rows[0]) : null;
};

export const getAttemptForRound = async (
  game: GameKind,
  roundKey: string,
  userId: number,
): Promise<GameAttempt | null> => {
  const result = await turso.execute({
    sql: `SELECT ${ATTEMPT_COLUMNS} FROM game_attempts
          WHERE game = ? AND round_key = ? AND user_id = ?`,
    args: [game, roundKey, userId],
  });
  return result.rows[0] ? attemptFromRow(result.rows[0]) : null;
};

/**
 * The caller's Five attempt for one IST day, without creating the day's round.
 *
 * The home banner runs on every visit, so it must not pay the daily round's
 * random pool build just to learn that nobody has played yet. An absent row is
 * the honest "today is still open" answer.
 */
export const getFiveAttemptForDay = async (
  userId: number,
  dayKey: string,
): Promise<GameAttempt | null> => {
  const result = await turso.execute({
    sql: `SELECT ${ATTEMPT_COLUMNS} FROM game_attempts
          WHERE game = 'five' AND day_key = ? AND user_id = ?
          LIMIT 1`,
    args: [dayKey, userId],
  });
  return result.rows[0] ? attemptFromRow(result.rows[0]) : null;
};

/**
 * Record one answer, but only if the attempt is still on the same question.
 * The conditional update is the double-tap guard; the caller treats a false
 * return as "that question already moved on".
 */
export const saveAnswer = async (input: {
  id: number;
  index: number;
  answers: AttemptAnswer[];
  score: number;
}): Promise<boolean> => {
  const result = await turso.execute({
    sql: `UPDATE game_attempts
          SET answers = ?, idx = ?, score = ?
          WHERE id = ? AND idx = ? AND status = 'active'`,
    args: [
      JSON.stringify(input.answers),
      input.index + 1,
      input.score,
      input.id,
      input.index,
    ],
  });
  return Number(result.rowsAffected) === 1;
};

/** Start the current question's clock when its card actually appears. */
export const touchShownAt = async (
  id: number,
  shownAt: string,
): Promise<void> => {
  await turso.execute({
    sql: `UPDATE game_attempts SET shown_at = ?
          WHERE id = ? AND status = 'active'`,
    args: [shownAt, id],
  });
};

export const finishAttempt = async (input: {
  id: number;
  score: number;
  points: number;
  streak: number;
  /** The attempt's own length: old runs may hold five, new runs ten. */
  questionCount: number;
  finishedAt: string;
}): Promise<boolean> => {
  const result = await turso.execute({
    sql: `UPDATE game_attempts
          SET status = 'done', score = ?, points = ?, streak = ?, idx = ?,
              finished_at = ?
          WHERE id = ? AND status = 'active'`,
    args: [
      input.score,
      input.points,
      input.streak,
      input.questionCount,
      input.finishedAt,
      input.id,
    ],
  });
  return Number(result.rowsAffected) === 1;
};

export const setAttemptDuel = async (
  attemptId: number,
  duelId: number,
): Promise<void> => {
  await turso.execute({
    sql: `UPDATE game_attempts SET duel_id = ? WHERE id = ?`,
    args: [duelId, attemptId],
  });
};

export interface NewDuel {
  challengerId: number;
  challengerRoll: string;
  challengerName: string | null;
  challengerSectionKey: string | null;
  challengerSectionLabel: string | null;
  challengerScore: number;
  challengerAttemptId: number;
  questionIds: number[];
  dayKey: string;
  weekKey: string;
  season: string;
  expiresAt: string;
}

export const createDuel = async (duel: NewDuel): Promise<number> => {
  const result = await turso.execute({
    sql: `INSERT OR IGNORE INTO game_duels
            (challenger_id, challenger_roll, challenger_name,
             challenger_section_key, challenger_section_label,
             challenger_score, challenger_attempt_id, question_ids,
             day_key, week_key, season, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      duel.challengerId,
      duel.challengerRoll.toUpperCase(),
      duel.challengerName,
      duel.challengerSectionKey,
      duel.challengerSectionLabel,
      duel.challengerScore,
      duel.challengerAttemptId,
      JSON.stringify(duel.questionIds),
      duel.dayKey,
      duel.weekKey,
      duel.season,
      duel.expiresAt,
    ],
  });

  if (Number(result.rowsAffected) === 1) {
    return Number(result.lastInsertRowid);
  }

  const existing = await getDuelByAttempt(duel.challengerAttemptId);
  if (!existing) throw new Error("duel could not be created");
  return existing.id;
};

const duelFromRow = (row: Record<string, unknown>): GameDuel => ({
  id: num(row.id),
  challengerId: num(row.challenger_id),
  challengerRoll: text(row.challenger_roll),
  challengerName: nullableText(row.challenger_name),
  challengerSectionKey: nullableText(row.challenger_section_key),
  challengerSectionLabel: nullableText(row.challenger_section_label),
  challengerScore: num(row.challenger_score),
  questionIds: jsonArray<number>(row.question_ids, []),
  dayKey: text(row.day_key),
  weekKey: text(row.week_key),
  season: text(row.season),
  status:
    text(row.status) === "done"
      ? "done"
      : text(row.status) === "expired"
        ? "expired"
        : "open",
  opponentId: row.opponent_id == null ? null : num(row.opponent_id),
  opponentRoll: nullableText(row.opponent_roll),
  opponentName: nullableText(row.opponent_name),
  opponentScore: row.opponent_score == null ? null : num(row.opponent_score),
  winnerId: row.winner_id == null ? null : num(row.winner_id),
  createdAt: text(row.created_at),
  finishedAt: nullableText(row.finished_at),
  expiresAt: text(row.expires_at),
});

const DUEL_COLUMNS = `id, challenger_id, challenger_roll, challenger_name,
  challenger_section_key, challenger_section_label, challenger_score,
  question_ids, day_key, week_key, season, status, opponent_id, opponent_roll,
  opponent_name, opponent_score, winner_id, created_at, finished_at,
  expires_at`;

export const getDuel = async (id: number): Promise<GameDuel | null> => {
  const result = await turso.execute({
    sql: `SELECT ${DUEL_COLUMNS} FROM game_duels WHERE id = ?`,
    args: [id],
  });
  return result.rows[0] ? duelFromRow(result.rows[0]) : null;
};

export const getDuelByAttempt = async (
  attemptId: number,
): Promise<GameDuel | null> => {
  const result = await turso.execute({
    sql: `SELECT ${DUEL_COLUMNS} FROM game_duels WHERE challenger_attempt_id = ?`,
    args: [attemptId],
  });
  return result.rows[0] ? duelFromRow(result.rows[0]) : null;
};

/**
 * Claim the open duel for one opponent.
 *
 * A shared link can be tapped by a whole group at once. The conditional
 * update is the lock: the first account becomes the opponent, everyone else
 * is told the challenge is taken. The claim is set before the first question
 * so a second acceptor cannot start a parallel attempt.
 */
export const claimDuelOpponent = async (input: {
  duelId: number;
  userId: number;
  rollNo: string;
  displayName: string | null;
}): Promise<boolean> => {
  const result = await turso.execute({
    sql: `UPDATE game_duels
          SET opponent_id = ?, opponent_roll = ?, opponent_name = ?
          WHERE id = ? AND status = 'open' AND opponent_id IS NULL`,
    args: [
      input.userId,
      input.rollNo.toUpperCase(),
      input.displayName,
      input.duelId,
    ],
  });
  return Number(result.rowsAffected) === 1;
};

export const finishDuel = async (input: {
  id: number;
  opponentId: number;
  opponentRoll: string;
  opponentName: string | null;
  opponentScore: number;
  winnerId: number | null;
  finishedAt: string;
}): Promise<boolean> => {
  const result = await turso.execute({
    sql: `UPDATE game_duels
          SET status = 'done', opponent_id = ?, opponent_roll = ?,
              opponent_name = ?, opponent_score = ?, winner_id = ?,
              finished_at = ?
          WHERE id = ? AND status = 'open'`,
    args: [
      input.opponentId,
      input.opponentRoll.toUpperCase(),
      input.opponentName,
      input.opponentScore,
      input.winnerId,
      input.finishedAt,
      input.id,
    ],
  });
  return Number(result.rowsAffected) === 1;
};

export const expireDuel = async (id: number): Promise<void> => {
  await turso.execute({
    sql: `UPDATE game_duels SET status = 'expired' WHERE id = ? AND status = 'open'`,
    args: [id],
  });
};

export interface ScoreAward {
  season: string;
  weekKey: string;
  dayKey: string;
  userId: number;
  rollNo: string;
  sectionKey: string | null;
  sectionLabel: string | null;
  source: GameKind;
  ref: string;
  points: number;
}

/** One award, at most once. */
export const addScore = async (award: ScoreAward): Promise<boolean> => {
  const result = await turso.execute({
    sql: `INSERT OR IGNORE INTO game_scores
            (season, week_key, day_key, user_id, roll_no, section_key,
             section_label, source, ref, points)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      award.season,
      award.weekKey,
      award.dayKey,
      award.userId,
      award.rollNo.toUpperCase(),
      award.sectionKey,
      award.sectionLabel,
      award.source,
      award.ref,
      award.points,
    ],
  });
  return Number(result.rowsAffected) === 1;
};

/**
 * Close the duel runs the old finish path left `"active"`.
 *
 * `finishDuelAttempt` used to close the duel row and pay both sides without
 * marking the opponent's attempt done, so a finished duel run could sit
 * active forever: it never counted as a play, and reopening the challenge
 * pointed at a question that no longer existed. Every boot repairs what it
 * finds; the finish is conditional on `active`, so a second run is a no-op.
 */
export const repairDuelAttempts = async (): Promise<number> => {
  const result = await turso.execute({
    sql: `SELECT a.id, a.score, a.points, a.streak, a.question_ids,
                 d.finished_at
          FROM game_attempts a
          JOIN game_duels d ON d.id = a.duel_id
          WHERE a.game = 'duel' AND a.status = 'active' AND d.status = 'done'`,
  });

  let repaired = 0;
  for (const row of result.rows) {
    const finished = await finishAttempt({
      id: num(row.id),
      score: num(row.score),
      points: num(row.points),
      streak: num(row.streak),
      questionCount: jsonArray<number>(row.question_ids, []).length,
      finishedAt: nullableText(row.finished_at) ?? new Date().toISOString(),
    });
    if (finished) repaired += 1;
  }
  return repaired;
};

/** The player's rank for one day's Five, with ties going to the earlier run. */
export const getFiveRank = async (input: {
  dayKey: string;
  points: number;
  finishedAt: string;
}): Promise<{ rank: number; total: number }> => {
  const ahead = await turso.execute({
    sql: `SELECT COUNT(*) AS n FROM game_attempts
          WHERE game = 'five' AND day_key = ? AND status = 'done'
            AND (points > ? OR (points = ? AND finished_at < ?))`,
    args: [input.dayKey, input.points, input.points, input.finishedAt],
  });
  const total = await turso.execute({
    sql: `SELECT COUNT(*) AS n FROM game_attempts
          WHERE game = 'five' AND day_key = ? AND status = 'done'`,
    args: [input.dayKey],
  });
  return {
    rank: num(ahead.rows[0]?.n) + 1,
    total: num(total.rows[0]?.n),
  };
};

/** The week's player board, one page at a time. */
export const getWeekPlayers = async (
  season: string,
  weekKey: string,
  limit = 10,
  offset = 0,
): Promise<BoardPlayer[]> => {
  const result = await turso.execute({
    sql: `SELECT s.user_id, MAX(s.roll_no) AS roll_no,
                 MAX(p.display_name) AS display_name,
                 SUM(s.points) AS points,
                 (SELECT COUNT(*) FROM game_attempts a
                   WHERE a.user_id = s.user_id AND a.season = ?
                     AND a.week_key = ? AND a.status = 'done'
                     AND a.game = 'five') AS plays
          FROM game_scores s
          LEFT JOIN game_players p ON p.user_id = s.user_id
          WHERE s.season = ? AND s.week_key = ? AND s.source <> 'duel'
          GROUP BY s.user_id
          ORDER BY points DESC, s.user_id ASC
          LIMIT ? OFFSET ?`,
    args: [
      season,
      weekKey,
      season,
      weekKey,
      Math.max(1, Math.min(100, limit)),
      Math.max(0, Math.floor(offset)),
    ],
  });
  return result.rows.map((row) => ({
    userId: num(row.user_id),
    rollNo: text(row.roll_no),
    displayName: nullableText(row.display_name),
    points: num(row.points),
    plays: num(row.plays),
  }));
};

/** Every stored quiz attempt for one account, newest first. */
export const listAttemptsForUser = async (
  userId: number,
  limit = 200,
): Promise<GameAttempt[]> => {
  const result = await turso.execute({
    sql: `SELECT ${ATTEMPT_COLUMNS} FROM game_attempts
          WHERE user_id = ?
          ORDER BY COALESCE(finished_at, started_at) DESC, id DESC
          LIMIT ?`,
    args: [userId, Math.max(1, Math.min(500, Math.trunc(limit)))],
  });
  return result.rows.map(attemptFromRow);
};

/** How many attempts the account has in the store, for the truncation note. */
export const countAttemptsForUser = async (userId: number): Promise<number> => {
  const result = await turso.execute({
    sql: `SELECT COUNT(*) AS n FROM game_attempts WHERE user_id = ?`,
    args: [userId],
  });
  return num(result.rows[0]?.n);
};

/** One day's player board: today's daily runs, best first. */
export const getDayPlayers = async (
  dayKey: string,
  limit = 3,
): Promise<BoardPlayer[]> => {
  const result = await turso.execute({
    sql: `SELECT s.user_id, MAX(s.roll_no) AS roll_no,
                 MAX(p.display_name) AS display_name,
                 SUM(s.points) AS points,
                 (SELECT COUNT(*) FROM game_attempts a
                   WHERE a.user_id = s.user_id AND a.day_key = ?
                     AND a.status = 'done' AND a.game = 'five') AS plays
          FROM game_scores s
          LEFT JOIN game_players p ON p.user_id = s.user_id
          WHERE s.day_key = ? AND s.source <> 'duel'
          GROUP BY s.user_id
          ORDER BY points DESC, s.user_id ASC
          LIMIT ?`,
    args: [dayKey, dayKey, Math.max(1, Math.min(100, limit))],
  });
  return result.rows.map((row) => ({
    userId: num(row.user_id),
    rollNo: text(row.roll_no),
    displayName: nullableText(row.display_name),
    points: num(row.points),
    plays: num(row.plays),
  }));
};

/** How many players have scored this week, for a page's "of N" line. */
export const getWeekPlayerCount = async (
  season: string,
  weekKey: string,
): Promise<number> => {
  const result = await turso.execute({
    sql: `SELECT COUNT(*) AS n FROM (
            SELECT user_id FROM game_scores
            WHERE season = ? AND week_key = ? AND source <> 'duel'
            GROUP BY user_id
          )`,
    args: [season, weekKey],
  });
  return num(result.rows[0]?.n);
};

/**
 * The week's section board.
 *
 * Only verified students count for a section: an unverified account may hold a
 * roll it does not own, and its points must not carry a real section. Within
 * that, only each section's best ten players count, so a 200-person section
 * does not bury a 60-person one under raw headcount.
 */
export const getWeekSections = async (
  season: string,
  weekKey: string,
  limit = 10,
): Promise<BoardSection[]> => {
  const result = await turso.execute({
    sql: `WITH per_player AS (
            SELECT s.section_key, s.user_id, SUM(s.points) AS pts
            FROM game_scores s
            WHERE s.season = ? AND s.week_key = ? AND s.section_key IS NOT NULL
              AND s.source <> 'duel'
              AND EXISTS (
                SELECT 1 FROM roll_claims c
                WHERE UPPER(c.roll_no) = UPPER(s.roll_no)
              )
            GROUP BY s.section_key, s.user_id
          ), ranked AS (
            SELECT section_key, user_id, pts,
                   ROW_NUMBER() OVER (
                     PARTITION BY section_key ORDER BY pts DESC, user_id ASC
                   ) AS rn
            FROM per_player
          ), labels AS (
            SELECT section_key, MAX(section_label) AS section_label
            FROM game_scores
            WHERE season = ? AND week_key = ? AND source <> 'duel'
            GROUP BY section_key
          )
          SELECT r.section_key AS section_key,
                 COALESCE(l.section_label, r.section_key) AS section_label,
                 SUM(r.pts) AS points,
                 COUNT(*) AS players
          FROM ranked r
          LEFT JOIN labels l ON l.section_key = r.section_key
          WHERE r.rn <= 10
          GROUP BY r.section_key, l.section_label
          ORDER BY points DESC, r.section_key ASC
          LIMIT ?`,
    args: [season, weekKey, season, weekKey, Math.max(1, Math.min(100, limit))],
  });
  return result.rows.map((row) => ({
    key: text(row.section_key),
    label: text(row.section_label),
    points: num(row.points),
    players: num(row.players),
  }));
};

/**
 * The leading players of one section, for the board that shows only the
 * number-one section's top three. The same public-name source as the week's
 * player board.
 */
export const getSectionTopPlayers = async (
  season: string,
  weekKey: string,
  sectionKey: string,
  limit = 3,
): Promise<BoardPlayer[]> => {
  const result = await turso.execute({
    sql: `SELECT s.user_id, MAX(s.roll_no) AS roll_no,
                 MAX(p.display_name) AS display_name,
                 SUM(s.points) AS points,
                 (SELECT COUNT(*) FROM game_attempts a
                   WHERE a.user_id = s.user_id AND a.season = ?
                     AND a.week_key = ? AND a.status = 'done'
                     AND a.game = 'five') AS plays
          FROM game_scores s
          LEFT JOIN game_players p ON p.user_id = s.user_id
          WHERE s.season = ? AND s.week_key = ? AND s.section_key = ?
            AND s.source <> 'duel'
            AND EXISTS (
              SELECT 1 FROM roll_claims c
              WHERE UPPER(c.roll_no) = UPPER(s.roll_no)
            )
          GROUP BY s.user_id
          ORDER BY points DESC, s.user_id ASC
          LIMIT ?`,
    args: [
      season,
      weekKey,
      season,
      weekKey,
      sectionKey,
      Math.max(1, Math.min(10, limit)),
    ],
  });
  return result.rows.map((row) => ({
    userId: num(row.user_id),
    rollNo: text(row.roll_no),
    displayName: nullableText(row.display_name),
    points: num(row.points),
    plays: num(row.plays),
  }));
};

/** One player's week: points, rank and how many played. */
export const getPlayerWeek = async (
  season: string,
  weekKey: string,
  userId: number,
): Promise<{ points: number; rank: number | null; players: number }> => {
  const pointsResult = await turso.execute({
    sql: `SELECT COALESCE(SUM(points), 0) AS points
          FROM game_scores
          WHERE season = ? AND week_key = ? AND user_id = ?
            AND source <> 'duel'`,
    args: [season, weekKey, userId],
  });
  const points = num(pointsResult.rows[0]?.points);

  const totals = await turso.execute({
    sql: `SELECT COUNT(*) AS n FROM (
            SELECT user_id FROM game_scores
            WHERE season = ? AND week_key = ? AND source <> 'duel'
            GROUP BY user_id
          )`,
    args: [season, weekKey],
  });
  const players = num(totals.rows[0]?.n);

  if (points <= 0) return { points, rank: null, players };

  const ahead = await turso.execute({
    sql: `SELECT COUNT(*) AS n FROM (
            SELECT user_id, SUM(points) AS pts
            FROM game_scores
            WHERE season = ? AND week_key = ? AND source <> 'duel'
            GROUP BY user_id
          ) WHERE pts > ?`,
    args: [season, weekKey, points],
  });
  return { points, rank: num(ahead.rows[0]?.n) + 1, players };
};

/** One section's place on the same board. */
export const getSectionWeek = async (
  season: string,
  weekKey: string,
  sectionKey: string,
): Promise<{ rank: number; total: number; points: number } | null> => {
  const board = await getWeekSections(season, weekKey, 100);
  const index = board.findIndex((section) => section.key === sectionKey);
  if (index < 0) return null;
  return {
    rank: index + 1,
    total: board.length,
    points: board[index].points,
  };
};

/** Wins, losses and draws across finished duels. */
export const getDuelRecord = async (
  userId: number,
): Promise<{ wins: number; losses: number; draws: number }> => {
  const result = await turso.execute({
    sql: `SELECT
            COALESCE(SUM(CASE WHEN status = 'done' AND winner_id = ? THEN 1 ELSE 0 END), 0) AS wins,
            COALESCE(SUM(CASE WHEN status = 'done' AND winner_id IS NOT NULL AND winner_id != ? THEN 1 ELSE 0 END), 0) AS losses,
            COALESCE(SUM(CASE WHEN status = 'done' AND winner_id IS NULL THEN 1 ELSE 0 END), 0) AS draws
          FROM game_duels
          WHERE challenger_id = ? OR opponent_id = ?`,
    args: [userId, userId, userId, userId],
  });
  return {
    wins: num(result.rows[0]?.wins),
    losses: num(result.rows[0]?.losses),
    draws: num(result.rows[0]?.draws),
  };
};

/** The duel figures the admin panel's League view shows. */
export interface DuelBoardStats {
  /** Open challenges that have not expired yet. */
  open: number;
  /** Duels settled this week. */
  finishedWeek: number;
  /** Challenges that expired this week. */
  expiredWeek: number;
  /** Duels created today, whatever their state. */
  today: number;
  /** Distinct accounts in a duel this week (challengers and opponents). */
  players: number;
}

/**
 * The duel side of the admin League view.
 *
 * A duel awards no points and never joins the weekly boards, so it is counted
 * here instead: the open queue, this week's settled and expired matches, the
 * day's challenges, and how many distinct people duelled this week.
 */
export const getDuelBoardStats = async (
  season: string,
  weekKey: string,
  dayKey: string,
): Promise<DuelBoardStats> => {
  const [counts, players] = await turso.batch(
    [
      {
        sql: `SELECT
                COALESCE(SUM(CASE WHEN status = 'open'
                  AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                  THEN 1 ELSE 0 END), 0) AS open,
                COALESCE(SUM(CASE WHEN status = 'done'
                  AND season = ? AND week_key = ? THEN 1 ELSE 0 END), 0) AS finished_week,
                COALESCE(SUM(CASE WHEN status = 'expired'
                  AND season = ? AND week_key = ? THEN 1 ELSE 0 END), 0) AS expired_week,
                COALESCE(SUM(CASE WHEN day_key = ? THEN 1 ELSE 0 END), 0) AS today
              FROM game_duels`,
        args: [season, weekKey, season, weekKey, dayKey],
      },
      {
        sql: `SELECT COUNT(*) AS n FROM (
                SELECT challenger_id AS user_id FROM game_duels
                WHERE season = ? AND week_key = ?
                UNION
                SELECT opponent_id AS user_id FROM game_duels
                WHERE season = ? AND week_key = ? AND opponent_id IS NOT NULL
              )`,
        args: [season, weekKey, season, weekKey],
      },
    ],
    "read",
  );

  return {
    open: num(counts.rows[0]?.open),
    finishedWeek: num(counts.rows[0]?.finished_week),
    expiredWeek: num(counts.rows[0]?.expired_week),
    today: num(counts.rows[0]?.today),
    players: num(players.rows[0]?.n),
  };
};

/** The newest duels, for the admin panel's recent-matches table. */
export const getRecentDuels = async (limit = 20): Promise<GameDuel[]> => {
  const result = await turso.execute({
    sql: `SELECT ${DUEL_COLUMNS} FROM game_duels
          ORDER BY id DESC
          LIMIT ?`,
    args: [Math.max(1, Math.min(100, Math.trunc(limit)))],
  });
  return result.rows.map(duelFromRow);
};

export interface ChannelBoardState {
  chatId: string;
  messageId: number;
  /** The fingerprint of the rows the message last showed. */
  snapshot: string;
  /** When the snapshot last changed, ISO. */
  updatedAt: string;
}

/**
 * Where the channel's single live board message lives.
 *
 * One row: the message id, the chat it belongs to and the fingerprint of the
 * data it last showed. The scheduler compares the fingerprint before editing,
 * so an unchanged board is not touched.
 */
export const getChannelBoard = async (
  slot: string,
): Promise<ChannelBoardState | null> => {
  const result = await turso.execute({
    sql: `SELECT chat_id, message_id, snapshot, updated_at
          FROM game_channel_board WHERE slot = ?`,
    args: [slot],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    chatId: text(row.chat_id),
    messageId: num(row.message_id),
    snapshot: text(row.snapshot),
    updatedAt: text(row.updated_at),
  };
};

export const saveChannelBoard = async (state: {
  slot: string;
  chatId: string;
  messageId: number;
  snapshot: string;
  updatedAt: string;
}): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO game_channel_board
            (slot, chat_id, message_id, snapshot, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(slot) DO UPDATE SET
            chat_id = excluded.chat_id,
            message_id = excluded.message_id,
            snapshot = excluded.snapshot,
            updated_at = excluded.updated_at`,
    args: [
      state.slot,
      state.chatId,
      state.messageId,
      state.snapshot,
      state.updatedAt,
    ],
  });
};

/** Forget the board message, so the next sync posts a new one. */
export const clearChannelBoard = async (slot: string): Promise<void> => {
  await turso.execute({
    sql: `DELETE FROM game_channel_board WHERE slot = ?`,
    args: [slot],
  });
};
