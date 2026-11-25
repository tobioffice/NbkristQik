import { Router, type Request, type Response } from "express";
import { getQuestionsByIds, listAttemptsForUser } from "../db/game.model.js";
import { longestCorrectStreak } from "../games/scoring.js";
import { logger } from "../config/logger.js";
import { attachedIdentity } from "./resolveUser.js";

/**
 * The caller's own run history, with every question and the answer given.
 *
 * Only the signed-in account's finished daily runs are returned: duels are
 * matches, not runs, and an attempt still in progress has no final figures.
 * The correct option is safe here because the run is over; a client cannot use
 * it to answer a live question.
 */

const RUN_LIMIT = 20;

export const gameRunsRouter = Router();

gameRunsRouter.get("/games/runs", async (req: Request, res: Response) => {
  res.set("Cache-Control", "private, no-store");
  try {
    const identity = attachedIdentity(req, res);
    if (identity.status !== "authenticated") {
      res.status(401).json({
        success: false,
        error:
          identity.status === "invalid"
            ? identity.error
            : "Telegram initData required",
      });
      return;
    }

    const attempts = (await listAttemptsForUser(Number(identity.userId), 60))
      .filter((attempt) => attempt.game === "five" && attempt.status === "done")
      .slice(0, RUN_LIMIT);

    const questionIds = [...new Set(attempts.flatMap((a) => a.questionIds))];
    const questions = await getQuestionsByIds(questionIds);
    const byId = new Map(questions.map((question) => [question.id, question]));

    const runs = attempts.map((attempt) => {
      const answers = attempt.answers;
      const durationMs =
        attempt.finishedAt == null
          ? null
          : Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt);

      return {
        id: attempt.id,
        dayKey: attempt.dayKey,
        score: attempt.score,
        points: attempt.points,
        streak: longestCorrectStreak(answers),
        correct: answers.filter((answer) => answer.correct).length,
        total: attempt.questionIds.length,
        finishedAt: attempt.finishedAt,
        durationMs:
          durationMs != null && Number.isFinite(durationMs) && durationMs >= 0
            ? durationMs
            : null,
        questions: attempt.questionIds.map((id, index) => {
          const question = byId.get(id);
          const answer = answers[index] ?? null;
          return {
            index: index + 1,
            prompt:
              question?.prompt ?? "This question is no longer in the bank.",
            options: question?.options ?? [],
            correctIndex: question ? question.correct : null,
            chosenIndex: answer ? answer.option : null,
            correct: answer ? answer.correct : null,
            ms: answer ? answer.ms : null,
            points: answer ? answer.points : null,
          };
        }),
      };
    });

    res.json({ success: true, runs });
  } catch (e) {
    logger.error("[games] run history read failed:", e);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});
