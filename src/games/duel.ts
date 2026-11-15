import { bot } from "../bot/bot.js";
import {
  addScore,
  claimDuelOpponent,
  createAttempt,
  createDuel,
  expireDuel,
  finishDuel,
  getAttempt,
  getAttemptForRound,
  getDuel,
  getDuelByAttempt,
  getGamePlayer,
  getDuelRecord,
} from "../db/game.model.js";
import { logger } from "../config/logger.js";
import { trackActivity } from "../services/tracker.js";
import { duelInviteCard, duelRecordCard, duelResultCard } from "./cards.js";
import { seasonKey } from "./config.js";
import { sendOrEdit, showQuestion } from "./play.js";
import { loadPlayer, sendRegistrationPrompt } from "./player.js";
import { duelOutcome } from "./scoring.js";
import { istStamp } from "./time.js";
import type { GameAttempt, GameDuel } from "./types.js";

const DUEL_TTL_MS = 48 * 60 * 60 * 1000;

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

/** Turn a finished Five into a shareable challenge. */ export const createDuelFromAttempt =
  async ({
    attempt,
    chatId,
    replyTo,
  }: {
    attempt: GameAttempt;
    chatId: number;
    replyTo?: number;
  }): Promise<void> => {
    if (attempt.game !== "five" || attempt.status !== "done") {
      await say(
        chatId,
        "Finish today's five first, then challenge a friend.",
        replyTo,
      );
      return;
    }

    const existing = await getDuelByAttempt(attempt.id);
    if (existing) {
      if (existing.status === "open") {
        await sendOrEdit({
          chatId,
          replyTo,
          card: duelInviteCard({ duel: existing }),
        });
        return;
      }
      await say(
        chatId,
        "That challenge is already finished. Tomorrow's five makes a fresh one.",
        replyTo,
      );
      return;
    }

    const player = await getGamePlayer(attempt.userId);
    const duelId = await createDuel({
      challengerId: attempt.userId,
      challengerRoll: attempt.rollNo,
      challengerName: player?.displayName ?? null,
      challengerSectionKey: attempt.sectionKey,
      challengerSectionLabel: attempt.sectionLabel,
      challengerScore: attempt.score,
      challengerAttemptId: attempt.id,
      questionIds: attempt.questionIds,
      dayKey: attempt.dayKey,
      weekKey: attempt.weekKey,
      season: attempt.season,
      expiresAt: new Date(Date.now() + DUEL_TTL_MS).toISOString(),
    });

    const duel = await getDuel(duelId);
    if (!duel) throw new Error("the duel was not created");

    trackActivity({
      userId: attempt.userId,
      chatType: "private",
      action: "game:duel_create",
      detail: String(duel.id),
    });
    await sendOrEdit({
      chatId,
      replyTo,
      card: duelInviteCard({ duel }),
    });
  };

/**
 * Open a challenge link.
 *
 * The link is safe to tap more than once: the opponent's attempt is keyed by
 * the duel, so a resume, a second tap and a finish-all reconciliation all
 * land on the same run.
 */
export const startDuel = async ({
  chatId,
  userId,
  duelId,
  replyTo,
}: {
  chatId: number;
  userId: number;
  duelId: number;
  replyTo?: number;
}): Promise<void> => {
  const duel = await getDuel(duelId);
  if (!duel) {
    await say(chatId, "That challenge doesn't exist.", replyTo);
    return;
  }

  if (
    duel.status === "open" &&
    new Date(duel.expiresAt).getTime() < Date.now()
  ) {
    await expireDuel(duel.id);
    await say(chatId, "That challenge expired. Start today's five.", replyTo);
    return;
  }

  if (duel.status === "done") {
    if (userId === duel.challengerId || userId === duel.opponentId) {
      await showDuelResult({ duel, userId, chatId, replyTo });
    } else {
      await say(
        chatId,
        "That duel is already finished. Start today's five.",
        replyTo,
      );
    }
    return;
  }

  if (duel.status === "expired") {
    await say(chatId, "That challenge expired. Start today's five.", replyTo);
    return;
  }

  if (duel.challengerId === userId) {
    await sendOrEdit({
      chatId,
      replyTo,
      card: {
        ...duelInviteCard({ duel }),
        text:
          "<b>That's your own challenge.</b>\n" +
          "Send it to a friend; they get the same five questions.",
      },
    });
    return;
  }

  const player = await loadPlayer(userId);
  if (!player) {
    await sendRegistrationPrompt({ chatId, replyTo });
    return;
  }

  // A link shared in a group can be tapped by several friends at once. The
  // first claim wins; everyone else is told the challenge is taken.
  const claimed = await claimDuelOpponent({
    duelId: duel.id,
    userId,
    rollNo: player.rollNo,
    displayName: player.displayName,
  });
  if (!claimed) {
    const current = await getDuel(duel.id);
    if (!current) {
      await say(chatId, "That challenge doesn't exist.", replyTo);
      return;
    }
    if (current.status === "done") {
      await showDuelResult({ duel: current, userId, chatId, replyTo });
      return;
    }
    if (current.opponentId !== userId) {
      await say(
        chatId,
        "Someone already took this challenge. Start your own five.",
        replyTo,
      );
      return;
    }
  }

  const roundKey = `d${duel.id}`;
  const existing = await getAttemptForRound("duel", roundKey, userId);

  if (existing?.status === "done") {
    // The run finished but the duel row did not. Close it now rather than
    // showing the opponent a question they already answered.
    await finishDuelAttempt({
      attempt: existing,
      chatId,
      messageId: undefined,
      replyTo,
    });
    return;
  }

  if (existing) {
    await showQuestion({ chatId, attempt: existing, replyTo });
    return;
  }

  const stamp = istStamp();
  const attemptId = await createAttempt({
    game: "duel",
    roundKey,
    dayKey: stamp.date,
    weekKey: stamp.week,
    season: seasonKey(),
    userId,
    rollNo: player.rollNo,
    sectionKey: player.sectionKey,
    sectionLabel: player.sectionLabel,
    questionIds: duel.questionIds,
    duelId: duel.id,
    startedAt: new Date().toISOString(),
  });
  const attempt = await getAttempt(attemptId);
  if (!attempt) throw new Error("the duel attempt was not created");

  trackActivity({
    userId,
    chatType: "private",
    action: "game:duel_start",
    detail: String(duel.id),
  });
  await showQuestion({ chatId, attempt, replyTo });
};

/**
 * Close the opponent's run and pay both sides once.
 *
 * The conditional duel update is the lock: two quick finishes cannot both
 * write a winner, and the unique score key makes a retry harmless.
 */
export const finishDuelAttempt = async ({
  attempt,
  chatId,
  messageId,
  replyTo,
}: {
  attempt: GameAttempt;
  chatId: number;
  messageId?: number;
  replyTo?: number;
}): Promise<void> => {
  const duelId = attempt.duelId;
  if (!duelId) {
    await say(chatId, "That duel is missing its challenge.", replyTo);
    return;
  }

  const duel = await getDuel(duelId);
  if (!duel) {
    await say(chatId, "That challenge doesn't exist.", replyTo);
    return;
  }

  if (duel.status === "done") {
    await showDuelResult({
      duel,
      userId: attempt.userId,
      chatId,
      messageId,
      replyTo,
    });
    return;
  }
  if (duel.status === "expired") {
    await say(chatId, "That challenge expired. Start today's five.", replyTo);
    return;
  }
  if (attempt.userId === duel.challengerId) {
    await say(chatId, "That's your own challenge.", replyTo);
    return;
  }

  const outcome = duelOutcome(duel.challengerScore, attempt.score);
  const winnerId =
    outcome.winner === "draw"
      ? null
      : outcome.winner === "challenger"
        ? duel.challengerId
        : attempt.userId;
  const finishedAt = new Date().toISOString();

  const closed = await finishDuel({
    id: duel.id,
    opponentId: attempt.userId,
    opponentRoll: attempt.rollNo,
    opponentName: (await getGamePlayer(attempt.userId))?.displayName ?? null,
    opponentScore: attempt.score,
    winnerId,
    finishedAt,
  });

  const fresh = await getDuel(duel.id);
  if (!fresh) throw new Error("the finished duel could not be read back");
  if (!closed && fresh.status !== "done") {
    throw new Error("the duel could not be closed");
  }

  if (closed) {
    const stamp = istStamp();
    const season = seasonKey();

    await addScore({
      season,
      weekKey: stamp.week,
      dayKey: stamp.date,
      userId: fresh.challengerId,
      rollNo: fresh.challengerRoll,
      sectionKey: fresh.challengerSectionKey,
      sectionLabel: fresh.challengerSectionLabel,
      source: "duel",
      ref: `d${fresh.id}`,
      points: outcome.challengerPoints,
    });
    await addScore({
      season,
      weekKey: stamp.week,
      dayKey: stamp.date,
      userId: attempt.userId,
      rollNo: attempt.rollNo,
      sectionKey: attempt.sectionKey,
      sectionLabel: attempt.sectionLabel,
      source: "duel",
      ref: `d${fresh.id}`,
      points: outcome.opponentPoints,
    });

    trackActivity({
      userId: attempt.userId,
      chatType: "private",
      action: "game:duel_finish",
      detail: `${fresh.id}:${outcome.winner}`,
    });

    // The challenger is in another chat. A blocked bot or a deleted account
    // must not stop the opponent from seeing the result.
    const challengerCard = duelResultCard({
      duel: fresh,
      userId: fresh.challengerId,
    });
    await sendOrEdit({
      chatId: fresh.challengerId,
      card: challengerCard,
    }).catch((e: Error) =>
      logger.debug("[games] challenger result skipped:", e?.message ?? e),
    );
  }

  await showDuelResult({
    duel: fresh,
    userId: attempt.userId,
    chatId,
    messageId,
    replyTo,
  });
};

/** The result card for one participant. */
export const showDuelResult = async ({
  duel,
  userId,
  chatId,
  messageId,
  replyTo,
}: {
  duel: GameDuel;
  userId: number;
  chatId: number;
  messageId?: number;
  replyTo?: number;
}): Promise<void> => {
  await sendOrEdit({
    chatId,
    messageId,
    replyTo,
    card: duelResultCard({ duel, userId }),
  });
};

/** `/duel`: the record, plus today's run as a challenge when it exists. */
export const sendDuelRecord = async ({
  chatId,
  userId,
  replyTo,
}: {
  chatId: number;
  userId: number;
  replyTo?: number;
}): Promise<void> => {
  const stamp = istStamp();
  const attempt = await getAttemptForRound(
    "five",
    `five-${stamp.date}`,
    userId,
  );
  const record = await getDuelRecord(userId);

  await sendOrEdit({
    chatId,
    replyTo,
    card: duelRecordCard({
      record,
      attemptId: attempt?.status === "done" ? attempt.id : null,
    }),
  });
};
