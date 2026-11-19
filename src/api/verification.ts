import { Request, Response, Router } from "express";
import { requireIdentity } from "./resolveUser.js";
import {
  VerificationError,
  confirmEmailVerification,
  getVerificationState,
  setVerificationOptions,
  startEmailVerification,
} from "../services/verification/otp.js";
import { logger } from "../config/logger.js";

export const verificationRouter = Router();

const fail = (res: Response, e: unknown, where: string): void => {
  if (e instanceof VerificationError) {
    res.status(e.status).json({
      ok: false,
      error: e.message,
      ...(e.suggestions ? { suggestions: e.suggestions } : {}),
    });
    return;
  }
  logger.error(`[verify] ${where} failed:`, e);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
};

// GET /api/verification — has this account proved a roll, and is it hidden?
verificationRouter.get("/verification", async (req: Request, res: Response) => {
  res.set("Cache-Control", "private, no-store");
  try {
    const resolved = requireIdentity(req, res);
    if (!resolved) return;
    const state = await getVerificationState(resolved.userId);
    res.json({ ok: true, ...state });
  } catch (e) {
    fail(res, e, "state");
  }
});

// POST /api/verification/start — send a code to <roll>@nbkrist.org
verificationRouter.post(
  "/verification/start",
  async (req: Request, res: Response) => {
    try {
      const resolved = requireIdentity(req, res);
      if (!resolved) return;
      const rollNo = String(req.body?.rollNo ?? "").trim();
      const sent = await startEmailVerification(resolved.userId, rollNo);
      res.json({ ok: true, ...sent });
    } catch (e) {
      fail(res, e, "start");
    }
  },
);

// POST /api/verification/confirm — prove the code, claim the roll
verificationRouter.post(
  "/verification/confirm",
  async (req: Request, res: Response) => {
    try {
      const resolved = requireIdentity(req, res);
      if (!resolved) return;
      const rollNo = String(req.body?.rollNo ?? "").trim();
      const code = String(req.body?.code ?? "").trim();
      const state = await confirmEmailVerification(
        resolved.userId,
        rollNo,
        code,
      );
      res.json({ ok: true, ...state });
    } catch (e) {
      fail(res, e, "confirm");
    }
  },
);

// POST /api/verification/options — the owner's three privacy switches
verificationRouter.post(
  "/verification/options",
  async (req: Request, res: Response) => {
    try {
      const resolved = requireIdentity(req, res);
      if (!resolved) return;
      const { hideLeaderboard, blockLookups, blockRegistration } =
        req.body ?? {};
      if (
        typeof hideLeaderboard !== "boolean" ||
        typeof blockLookups !== "boolean" ||
        typeof blockRegistration !== "boolean"
      ) {
        res.status(400).json({
          ok: false,
          error:
            "hideLeaderboard, blockLookups and blockRegistration must all be booleans",
        });
        return;
      }
      const state = await setVerificationOptions(resolved.userId, {
        hideLeaderboard,
        blockLookups,
        blockRegistration,
      });
      res.json({ ok: true, ...state });
    } catch (e) {
      fail(res, e, "options");
    }
  },
);

// Deprecated alias for one deployed bundle: `blocked` used to mean all three.
verificationRouter.post(
  "/verification/block",
  async (req: Request, res: Response) => {
    try {
      const resolved = requireIdentity(req, res);
      if (!resolved) return;
      const blocked = req.body?.blocked;
      if (typeof blocked !== "boolean") {
        res.status(400).json({ ok: false, error: "blocked must be a boolean" });
        return;
      }
      const state = await setVerificationOptions(resolved.userId, {
        hideLeaderboard: blocked,
        blockLookups: blocked,
        blockRegistration: blocked,
      });
      res.json({ ok: true, ...state });
    } catch (e) {
      fail(res, e, "block");
    }
  },
);
