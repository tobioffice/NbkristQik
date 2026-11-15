import { bot } from "../bot/bot.js";
import {
  addScore,
  createAttempt,
  finishAttempt,
  getAttempt,
  getAttemptForRound,
  getFiveRank,
  getGamePlayer,
  getOrCreateDailyRound,
  getSectionWeek,
  setPlayerStreak,
} from "../db/game.model.js";
import { logger } from "../config/logger.js";
import { trackActivity } from "../services/tracker.js";
import { fiveResultCard } from "./cards.js";
import { seasonKey } from "./config.js";
import { sendOrEdit, showQuestion } from "./play.js";
import { loadPlayer, sendRegistrationPrompt } from "./player.js";
import { fivePoints, nextStreak } from "./scoring.js";
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

/**
 * Start or resume today's five.
 *
 * The attempt is the source of truth: a second tap, a restart or a stale
 * result card all land on the same run, and the daily row makes tomorrow a
 * different game.
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
  const player = await loadPlayer(userId);
  if (!player) {
    await sendRegistrationPrompt({ chatId, replyTo });
    return;
  }

  const stamp = istStamp();
  const round = await getOrCreateDailyRound(stamp.date);
  if (!round) {
    await say(
      chatId,
      "Today's set isn't ready yet. Try again in a few minutes.",
      replyTo,
    );
    return;
  }

  const existing = await getAttemptForRound("five", round.id, userId);
  if (existing?.status === "done") {
    await showFiveResult({
      attempt: existing,
      chatId,
      replyTo,
      alreadyPlayed: true,
    });
    return;
  }

  if (existing) {
    trackActivity({
      userId,
      chatType: "private",
      action: "game:five_resume",
      detail: stamp.date,
    });
    await showQuestion({ chatId, attempt: existing, replyTo });
    return;
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
    questionIds: round.questionIds,
    startedAt: new Date().toISOString(),
  });
  const attempt = await getAttempt(attemptId);
  if (!attempt) throw new Error("the daily attempt was not created");

  trackActivity({
    userId,
    chatType: "private",
    action: "game:five_start",
    detail: stamp.date,
  });
  await showQuestion({ chatId, attempt, replyTo });
};

/**
 * Close a finished run.
 *
 * The streak belongs to the attempt's own day, not to the clock at the moment
 * the last answer lands: a run that starts before midnight and ends after it
 * must still count for the day it began.
 */
export const finishFive = async ({
  attempt,
  chatId,
  messageId,
}: {
  attempt: GameAttempt;
  chatId: number;
  messageId?: number;
}): Promise<void> => {
  let current = attempt;

  if (current.status === "active") {
    const player = await getGamePlayer(current.userId);
    const streak = nextStreak(
      player?.lastFive ?? null,
      current.dayKey,
      player?.streak ?? 0,
    );
    const points = fivePoints(current.score, streak);
    const finishedAt = new Date().toISOString();

    const finished = await finishAttempt({
      id: current.id,
      score: current.score,
      points,
      streak,
      finishedAt,
    });

    if (finished) {
      await setPlayerStreak({
        userId: current.userId,
        streak,
        bestStreak: Math.max(player?.bestStreak ?? 0, streak),
        lastFive: current.dayKey,
      });
      trackActivity({
        userId: current.userId,
        chatType: "private",
        action: "game:five_finish",
        detail: `${current.dayKey}:${current.score}`,
      });
    }

    const fresh = await getAttempt(current.id);
    if (!fresh) {
      logger.warn("[games] a finished attempt could not be read back");
      return;
    }
    current = fresh;
  }

  await showFiveResult({
    attempt: current,
    chatId,
    messageId,
    alreadyPlayed: false,
  });
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
  // Repair an award lost between the finish and the score write. The insert
  // is unique on (source, ref, user_id), so every later view is a no-op.
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

  await sendOrEdit({
    chatId,
    messageId,
    replyTo,
    card: fiveResultCard({
      attempt,
      rank: rank.rank,
      total: rank.total,
      section:
        section && attempt.sectionLabel
          ? {
              label: attempt.sectionLabel,
              rank: section.rank,
              total: section.total,
            }
          : null,
      alreadyPlayed,
    }),
  });
};
