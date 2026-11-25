import { bot } from "../bot/bot.js";
import {
  addScore,
  createAttempt,
  finishAttempt,
  getActiveQuestionIds,
  getAttempt,
  getAttemptForRound,
  getFiveRank,
  getOrCreateDailyRound,
  getQuestionsByIds,
  getSectionWeek,
  getSeenQuestionIds,
} from "../db/game.model.js";
import { logger } from "../config/logger.js";
import { trackActivity } from "../services/tracker.js";
import { fiveResultCard } from "./cards.js";
import { seasonKey } from "./config.js";
import { sendOrEdit, showQuestion } from "./play.js";
import { loadPlayer, sendRegistrationPrompt } from "./player.js";
import {
  fivePoints,
  longestCorrectStreak,
  QUESTIONS_PER_RUN,
} from "./scoring.js";
import { pickFreshQuestionIds } from "./selection.js";
import { istStamp } from "./time.js";
import type { GameAttempt } from "./types.js";

const say = async (
  chatId: number,
  text: string,
  replyTo?: number,
): Promise<void> => {
  await bot.api.sendMessage({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {}),
  });
};

/** What today's run looks like before a question is on screen. */
export type FiveStart =
  | { state: "needs-roll" }
  | { state: "not-ready" }
  | { state: "done"; attempt: GameAttempt }
  | { state: "playing"; attempt: GameAttempt; created: boolean };

/**
 * Start or resume today's run, without sending anything.
 *
 * The attempt is the source of truth: a second tap, a restart or a stale
 * result card all land on the same run, and the daily row makes tomorrow a
 * different game. Both surfaces use this, so the bot and the Mini App can
 * never disagree about which run exists.
 */
export const startFiveRun = async (userId: number): Promise<FiveStart> => {
  const player = await loadPlayer(userId);
  if (!player) return { state: "needs-roll" };

  const stamp = istStamp();
  const round = await getOrCreateDailyRound(stamp.date);
  if (!round) return { state: "not-ready" };

  const existing = await getAttemptForRound("five", round.id, userId);
  if (existing?.status === "done") {
    return { state: "done", attempt: existing };
  }
  if (existing) {
    return { state: "playing", attempt: existing, created: false };
  }

  // A run never repeats a question the player has already been shown. The
  // day's pool is the first source; the rest of the bank fills the gap when
  // the player has seen too much of today's thirty.
  const [history, bank] = await Promise.all([
    getSeenQuestionIds(userId),
    getActiveQuestionIds(),
  ]);
  const fresh = pickFreshQuestionIds({
    pool: round.questionIds,
    bank,
    seen: history,
    count: QUESTIONS_PER_RUN,
  });
  if (fresh.repeated.length > 0) {
    // The bank has no unseen question left for this player. The run is still
    // playable, with the questions seen longest ago; grow the bank to stop it.
    logger.warn(
      `[games] question bank exhausted: ${fresh.repeated.length} repeated question(s) in a daily run`,
    );
  }

  const attemptId = await createAttempt({
    game: "five",
    roundKey: round.id,
    dayKey: stamp.date,
    weekKey: stamp.week,
    season: seasonKey(),
    userId,
    rollNo: player.rollNo,
    sectionKey: player.sectionKey,
    sectionLabel: player.sectionLabel,
    questionIds: fresh.ids,
    startedAt: new Date().toISOString(),
  });
  const attempt = await getAttempt(attemptId);
  if (!attempt) throw new Error("the daily attempt was not created");
  return { state: "playing", attempt, created: true };
};

/**
 * Start or resume today's run in the chat.
 *
 * The messaging and the activity row stay here; the run itself comes from
 * `startFiveRun` so the web app follows the same rules.
 */
export const startDailyFive = async ({
  chatId,
  userId,
  replyTo,
}: {
  chatId: number;
  userId: number;
  replyTo?: number;
}): Promise<void> => {
  const started = await startFiveRun(userId);

  if (started.state === "needs-roll") {
    await sendRegistrationPrompt({ chatId, replyTo });
    return;
  }
  if (started.state === "not-ready") {
    await say(
      chatId,
      "Today's set isn't ready yet. Try again in a few minutes.",
      replyTo,
    );
    return;
  }
  if (started.state === "done") {
    await showFiveResult({
      attempt: started.attempt,
      chatId,
      replyTo,
      alreadyPlayed: true,
    });
    return;
  }

  trackActivity({
    userId,
    chatType: "private",
    action: started.created ? "game:five_start" : "game:five_resume",
    detail: started.attempt.dayKey,
  });
  await showQuestion({ chatId, attempt: started.attempt, replyTo });
};

export interface FiveFinish {
  /** Null only when the finished row could not be read back. */
  attempt: GameAttempt | null;
  /** True only when this call moved the attempt to done. */
  finished: boolean;
}

/**
 * Close a finished run, without sending anything.
 *
 * The streak is the longest run of correct answers in this attempt, read from
 * the saved answers. It decides the seasonal bonus on top of the run score.
 */
export const finishFiveRun = async (
  attempt: GameAttempt,
): Promise<FiveFinish> => {
  if (attempt.status !== "active") return { attempt, finished: false };

  const streak = longestCorrectStreak(attempt.answers);
  const points = fivePoints(attempt.score, streak);
  const finishedAt = new Date().toISOString();

  const finished = await finishAttempt({
    id: attempt.id,
    score: attempt.score,
    points,
    streak,
    questionCount: attempt.questionIds.length,
    finishedAt,
  });

  const fresh = await getAttempt(attempt.id);
  if (!fresh) {
    logger.warn("[games] a finished attempt could not be read back");
    return { attempt: null, finished };
  }
  return { attempt: fresh, finished };
};

/** Close a finished run and put the result card in the chat. */
export const finishFive = async ({
  attempt,
  chatId,
  messageId,
}: {
  attempt: GameAttempt;
  chatId: number;
  messageId?: number;
}): Promise<void> => {
  const finalized = await finishFiveRun(attempt);
  if (!finalized.attempt) return;

  if (finalized.finished) {
    trackActivity({
      userId: finalized.attempt.userId,
      chatType: "private",
      action: "game:five_finish",
      detail: `${finalized.attempt.dayKey}:${finalized.attempt.score}`,
    });
  }

  await showFiveResult({
    attempt: finalized.attempt,
    chatId,
    messageId,
    alreadyPlayed: false,
  });
};

/** One question as the reader sees it. The correct option stays on the server. */
export interface FiveQuestionView {
  /** 0-based question position; the screen prints it + 1. */
  index: number;
  total: number;
  prompt: string;
  options: string[];
}

/** The attempt's current question, or null when it has run past its set. */
export const fiveQuestionView = async (
  attempt: GameAttempt,
): Promise<FiveQuestionView | null> => {
  const questionId = attempt.questionIds[attempt.idx];
  if (!questionId) return null;

  const questions = await getQuestionsByIds([questionId]);
  const question = questions[0];
  if (!question) throw new Error("the attempt points at a missing question");

  return {
    index: attempt.idx,
    total: attempt.questionIds.length,
    prompt: question.prompt,
    options: question.options,
  };
};

/** Everything a result screen prints, read once. */
export interface FiveResultView {
  correct: number;
  total: number;
  score: number;
  points: number;
  streak: number;
  /** The day's rank and field size. */
  rank: number;
  players: number;
  section: { label: string; rank: number; total: number } | null;
}

/**
 * The finished run's numbers, safe to read more than once.
 *
 * The award repair is idempotent (the insert is unique on source/ref/user), so
 * a result read after a crash between the finish and the score write still
 * lands the points.
 */
export const fiveResultView = async (
  attempt: GameAttempt,
): Promise<FiveResultView> => {
  if (attempt.status === "done" && attempt.points > 0) {
    await addScore({
      season: attempt.season,
      weekKey: attempt.weekKey,
      dayKey: attempt.dayKey,
      userId: attempt.userId,
      rollNo: attempt.rollNo,
      sectionKey: attempt.sectionKey,
      sectionLabel: attempt.sectionLabel,
      source: "five",
      ref: `a${attempt.id}`,
      points: attempt.points,
    });
  }

  const rank = await getFiveRank({
    dayKey: attempt.dayKey,
    points: attempt.points,
    finishedAt: attempt.finishedAt ?? new Date().toISOString(),
  });
  const section =
    attempt.sectionKey && attempt.sectionLabel
      ? await getSectionWeek(
          attempt.season,
          attempt.weekKey,
          attempt.sectionKey,
        )
      : null;

  return {
    correct: attempt.answers.filter((answer) => answer.correct).length,
    total: attempt.answers.length || attempt.questionIds.length,
    score: attempt.score,
    points: attempt.points,
    streak: attempt.streak,
    rank: rank.rank,
    players: rank.total,
    section:
      section && attempt.sectionLabel
        ? {
            label: attempt.sectionLabel,
            rank: section.rank,
            total: section.total,
          }
        : null,
  };
};

/** The result card, safe to call more than once for the same attempt. */
export const showFiveResult = async ({
  attempt,
  chatId,
  messageId,
  replyTo,
  alreadyPlayed,
}: {
  attempt: GameAttempt;
  chatId: number;
  messageId?: number;
  replyTo?: number;
  alreadyPlayed: boolean;
}): Promise<void> => {
  const view = await fiveResultView(attempt);

  await sendOrEdit({
    chatId,
    messageId,
    replyTo,
    card: fiveResultCard({
      attempt,
      rank: view.rank,
      total: view.players,
      section: view.section,
      alreadyPlayed,
    }),
  });
};
