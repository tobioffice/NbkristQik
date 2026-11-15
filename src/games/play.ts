import { bot } from "../bot/bot.js";
import {
  getAttempt,
  getDuel,
  getQuestionsByIds,
  saveAnswer,
  touchShownAt,
} from "../db/game.model.js";
import { questionCard, type Card } from "./cards.js";
import { answerPoints, QUESTION_LIMIT_MS } from "./scoring.js";
import type { AttemptAnswer, GameAttempt } from "./types.js";

/**
 * One question at a time, in one edited message.
 *
 * Editing keeps the chat clean and makes the card feel live; a failure falls
 * back to a fresh message, so an old message that cannot be edited never
 * stops the run.
 */
export const sendOrEdit = async ({
  chatId,
  messageId,
  replyTo,
  card,
}: {
  chatId: number;
  messageId?: number;
  replyTo?: number;
  card: Card;
}): Promise<number> => {
  if (messageId) {
    try {
      await bot.api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: card.text,
        parse_mode: "HTML",
        ...(card.markup ? { reply_markup: card.markup } : {}),
      });
      return messageId;
    } catch {
      // The card may be too old to edit, or the client may have replaced it.
      // A new message is the honest next step.
    }
  }

  const sent = await bot.api.sendMessage({
    chat_id: chatId,
    text: card.text,
    parse_mode: "HTML",
    ...(card.markup ? { reply_markup: card.markup } : {}),
    ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {}),
  });
  return sent.message_id;
};

/** Show the attempt's current question. Returns the card's message id. */
export const showQuestion = async ({
  chatId,
  attempt,
  messageId,
  replyTo,
}: {
  chatId: number;
  attempt: GameAttempt;
  messageId?: number;
  replyTo?: number;
}): Promise<number | null> => {
  const questionId = attempt.questionIds[attempt.idx];
  if (!questionId) return null;

  const questions = await getQuestionsByIds([questionId]);
  const question = questions[0];
  if (!question) throw new Error("the attempt points at a missing question");

  const duel = attempt.duelId ? await getDuel(attempt.duelId) : null;
  const cardMessageId = await sendOrEdit({
    chatId,
    messageId,
    replyTo,
    card: questionCard({
      attempt,
      question,
      index: attempt.idx,
      duelTarget: duel?.challengerScore,
    }),
  });
  await touchShownAt(attempt.id, new Date().toISOString());
  return cardMessageId;
};

export interface AnswerResult {
  attempt: GameAttempt;
  correct: boolean;
  timedOut: boolean;
  earned: number;
  done: boolean;
}

/**
 * Record one answer. `"stale"` means the tap was for an older question, or
 * another tap already recorded this one; it is never an error to show.
 */
export const recordAnswer = async ({
  attempt,
  index,
  option,
}: {
  attempt: GameAttempt;
  index: number;
  option: number;
}): Promise<AnswerResult | "stale"> => {
  if (attempt.status !== "active" || attempt.idx !== index) return "stale";

  const questionId = attempt.questionIds[index];
  const questions = await getQuestionsByIds([questionId]);
  const question = questions[0];
  if (!question) throw new Error("the attempt points at a missing question");

  const startedAt = new Date(attempt.shownAt ?? attempt.startedAt).getTime();
  const elapsed = Math.max(0, Date.now() - startedAt);
  const timedOut = elapsed > QUESTION_LIMIT_MS;
  const correct = !timedOut && option === question.correct;
  const earned = answerPoints(correct, elapsed);
  const answers: AttemptAnswer[] = [
    ...attempt.answers,
    { option, correct, ms: elapsed, points: earned },
  ];
  const score = attempt.score + earned;

  const saved = await saveAnswer({
    id: attempt.id,
    index,
    answers,
    score,
  });
  if (!saved) return "stale";

  const updated = await getAttempt(attempt.id);
  if (!updated) throw new Error("the attempt vanished after an answer");

  return {
    attempt: updated,
    correct,
    timedOut,
    earned,
    done: updated.idx >= updated.questionIds.length,
  };
};
