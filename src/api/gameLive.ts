import { Router, type Request, type Response } from "express";
import { logger } from "../config/logger.js";
import { getFiveAttemptForDay } from "../db/game.model.js";
import { getRegistration } from "../db/registration.model.js";
import { weekLabel } from "../games/cards.js";
import { QUESTIONS_PER_RUN } from "../games/scoring.js";
import { istStamp } from "../games/time.js";
import type { GameAttempt } from "../games/types.js";
import { attachedIdentity } from "./resolveUser.js";

/**
 * The league, as the home banner needs it: the IST week and the caller's run
 * today.
 *
 * The week board is public, but "have I played today" is not, so this is the
 * one games route a shared cache may never hold for a signed-in caller. The
 * banner also runs on every visit to the first screen, so this route does not
 * build the day's question round; it only reads the attempt the bot already
 * wrote. An anonymous caller gets the same week the channel is playing for.
 */

/** What the banner says about the caller's run, without exposing the run. */
interface LiveRun {
  state: "open" | "playing" | "done";
  questions: number;
  /** The question to resume, 1-based, while a run is active. */
  question?: number;
  /** Season points the finished run earned. */
  points?: number;
}

interface LivePlayer {
  registered: boolean;
  /** Null until the account has saved a roll: there is nothing to play for. */
  run: LiveRun | null;
}

const runOf = (attempt: GameAttempt | null): LiveRun => {
  if (!attempt) {
    return { state: "open", questions: QUESTIONS_PER_RUN };
  }

  const questions = attempt.questionIds.length || QUESTIONS_PER_RUN;
  if (attempt.status === "active") {
    return {
      state: "playing",
      questions,
      question: Math.min(attempt.idx + 1, questions),
    };
  }

  return { state: "done", questions, points: attempt.points };
};

export const gameLiveRouter = Router();

gameLiveRouter.get("/games/live", async (req: Request, res: Response) => {
  try {
    // A presented-but-broken signature is still a 401, like the public board:
    // a client that lost its launch data must not silently read as anonymous.
    const identity = attachedIdentity(req, res);
    if (identity.status === "invalid") {
      res.set("Cache-Control", "no-store");
      res.status(401).json({ success: false, error: identity.error });
      return;
    }

    const stamp = istStamp();
    const body: {
      success: true;
      weekLabel: string;
      me: LivePlayer | null;
    } = {
      success: true,
      weekLabel: weekLabel(stamp.monday),
      me: null,
    };

    if (identity.status === "authenticated") {
      const registration = await getRegistration(identity.userId);
      if (!registration) {
        body.me = { registered: false, run: null };
      } else {
        const attempt = await getFiveAttemptForDay(
          Number(identity.userId),
          stamp.date,
        );
        body.me = { registered: true, run: runOf(attempt) };
      }
      // Personal state: never store it, never let a shared cache replay it.
      res.set("Cache-Control", "private, no-store");
    } else {
      // Everyone sees the same week and no personal line.
      res.set("Cache-Control", "public, max-age=30");
    }

    res.json(body);
  } catch (e) {
    logger.error("[games] live read failed:", e);
    res.set("Cache-Control", "no-store");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});
