import { Router, type Request, type Response } from "express";
import { logger } from "../config/logger.js";
import { getAttempt, touchShownAt } from "../db/game.model.js";
import {
  finishFiveRun,
  fiveQuestionView,
  fiveResultView,
  startFiveRun,
} from "../games/five.js";
import { recordAnswer } from "../games/play.js";
import { QUESTION_LIMIT_MS } from "../games/scoring.js";
import type { GameAttempt } from "../games/types.js";
import { trackActivity } from "../services/tracker.js";
import { requireIdentity } from "./resolveUser.js";

/**
 * The daily run, playable inside the Mini App.
 *
 * The bot still owns its chat copy of the run; both surfaces read and write
 * the same attempt row, so a run started in either place resumes in the other.
 * The correct option never leaves the database: a start or answer response
 * carries the prompt and the four options only, and every score is computed
 * on the server from the stored answer and the time the question was shown.
 */

/** The question as the browser sees it: no correct option, just the clock. */
interface PlayQuestion {
  /** 0-based position; the reader prints it + 1. */
  index: number;
  total: number;
  prompt: string;
  options: string[];
  /** How long this question is worth points, from the moment it was shown. */
  limitMs: number;
}

/**
 * Show the attempt's current question: the response is the moment it went on
 * screen, so this also starts the clock, exactly as the bot does when it sends
 * a question card.
 */
const questionOf = async (
  attempt: GameAttempt,
): Promise<PlayQuestion | null> => {
  const view = await fiveQuestionView(attempt);
  if (!view) return null;

  await touchShownAt(attempt.id, new Date().toISOString());
  return { ...view, limitMs: QUESTION_LIMIT_MS };
};

/** A finished set, shared by both endpoints. */
const doneBody = async (attempt: GameAttempt, alreadyPlayed: boolean) => {
  const result = await fiveResultView(attempt);
  return {
    success: true as const,
    state: "done" as const,
    alreadyPlayed,
    result,
  };
};

/** Finish the attempt (a normal last answer, or one that ran past its set). */
const finishAndShowResult = async (attempt: GameAttempt) => {
  const finalized = await finishFiveRun(attempt);
  if (!finalized.attempt) return null;
  if (finalized.finished) {
    trackActivity({
      userId: finalized.attempt.userId,
      chatType: "unknown",
      action: "game:five_finish",
      detail: `${finalized.attempt.dayKey}:${finalized.attempt.score}`,
    });
  }
  return doneBody(finalized.attempt, false);
};

const internalError = (res: Response) => {
  res.status(500).json({ success: false, error: "Internal Server Error" });
};

export const gamesPlayRouter = Router();

/**
 * Open today's run: resume the active attempt, show the finished one, or
 * create the day's first attempt.
 *
 * A write, because showing the first question starts its clock and may create
 * the attempt; the route is `private, no-store` for the same reason.
 */
gamesPlayRouter.post(
  "/games/five/start",
  async (req: Request, res: Response) => {
    res.set("Cache-Control", "private, no-store");
    try {
      const caller = requireIdentity(req, res);
      if (!caller) return;

      const userId = Number(caller.userId);
      const started = await startFiveRun(userId);

      if (started.state === "needs-roll") {
        res.json({ success: true, state: "needs-roll" });
        return;
      }
      if (started.state === "not-ready") {
        res.json({ success: true, state: "not-ready" });
        return;
      }
      if (started.state === "done") {
        res.json(await doneBody(started.attempt, true));
        return;
      }

      trackActivity({
        userId,
        chatType: "unknown",
        action: started.created ? "game:five_start" : "game:five_resume",
        detail: started.attempt.dayKey,
      });

      const question = await questionOf(started.attempt);
      if (!question) {
        const closed = await finishAndShowResult(started.attempt);
        if (!closed) {
          internalError(res);
          return;
        }
        res.json(closed);
        return;
      }

      res.json({
        success: true,
        state: "playing",
        attemptId: started.attempt.id,
        score: started.attempt.score,
        question,
      });
    } catch (e) {
      logger.error("[games] five start failed:", e);
      internalError(res);
    }
  },
);

/**
 * Record one answer and hand back the next question, or the finished result.
 *
 * `index` is what the browser displayed, so a double tap or a stale tab is
 * refused with 409 instead of answering the following question by accident.
 */
gamesPlayRouter.post(
  "/games/five/answer",
  async (req: Request, res: Response) => {
    res.set("Cache-Control", "private, no-store");
    try {
      const caller = requireIdentity(req, res);
      if (!caller) return;

      const userId = Number(caller.userId);
      const attemptId = Number(req.body?.attemptId);
      const index = Number(req.body?.index);
      const option = Number(req.body?.option);

      const valid =
        Number.isInteger(attemptId) &&
        attemptId > 0 &&
        Number.isInteger(index) &&
        index >= 0 &&
        index <= 100 &&
        Number.isInteger(option) &&
        option >= 0 &&
        option <= 9;
      if (!valid) {
        res.status(400).json({ success: false, error: "Validation failed" });
        return;
      }

      const attempt = await getAttempt(attemptId);
      if (!attempt || attempt.game !== "five" || attempt.userId !== userId) {
        res.status(404).json({ success: false, error: "Not Found" });
        return;
      }

      // A duplicate tap after the final answer lands here. The result is the
      // honest answer to "what happened?", not an error.
      if (attempt.status === "done") {
        res.json(await doneBody(attempt, true));
        return;
      }

      const answered = await recordAnswer({ attempt, index, option });
      if (answered === "stale") {
        res.status(409).json({
          success: false,
          state: "stale",
          error: "That question already moved on.",
        });
        return;
      }

      if (answered.done) {
        const closed = await finishAndShowResult(answered.attempt);
        if (!closed) {
          internalError(res);
          return;
        }
        res.json(closed);
        return;
      }

      const question = await questionOf(answered.attempt);
      if (!question) {
        const closed = await finishAndShowResult(answered.attempt);
        if (!closed) {
          internalError(res);
          return;
        }
        res.json(closed);
        return;
      }

      res.json({
        success: true,
        state: "playing",
        attemptId: answered.attempt.id,
        score: answered.attempt.score,
        question,
        feedback: {
          correct: answered.correct,
          timedOut: answered.timedOut,
          earned: answered.earned,
        },
      });
    } catch (e) {
      logger.error("[games] five answer failed:", e);
      internalError(res);
    }
  },
);
