import { Request, Response, Router } from "express";
import { resolveUserId } from "./resolveUser.js";
import {
  getRegistration,
  upsertRegistration,
} from "../db/registration.model.js";
import { getTgUserRoll } from "../db/student.model.js";
import {
  getStudentCached,
  StudentNotFoundError,
} from "../services/redis/utils.js";
import { trackActivity } from "../services/tracker.js";
import { ROLL_REGEX } from "../constants/index.js";
import { logger } from "../config/logger.js";

export const profileRouter = Router();

const unauthorized = (res: Response, error: string | undefined) => {
  res
    .status(401)
    .json({ found: false, error: error ?? "Telegram initData required" });
};

// GET /api/profile — registration + live student info for prefill
profileRouter.get("/profile", async (req: Request, res: Response) => {
  try {
    const resolved = resolveUserId(req);
    if (!resolved || resolved.error) {
      unauthorized(res, resolved?.error);
      return;
    }

    const registration = await getRegistration(resolved.userId);
    const student = registration
      ? await getStudentCached(registration.roll_no).catch(() => null)
      : null;

    // a registered roll that vanished from studentsnew (semester rollover)
    // must surface clearly so the UI can prompt a profile update
    if (registration && !student) {
      res.json({
        found: true,
        stale: true,
        registration,
        student: null,
      });
      return;
    }

    // unregistered users still get their past-lookup roll as a prefill hint
    if (!registration) {
      const suggested = await getTgUserRoll(resolved.userId).catch(() => null);
      res.json({ found: false, suggestion: suggested });
      return;
    }

    res.json({ found: true, registration, student });
  } catch (e) {
    logger.error("[profile] GET failed:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /api/register — create or edit the registration
profileRouter.post("/register", async (req: Request, res: Response) => {
  try {
    const resolved = resolveUserId(req);
    if (!resolved || resolved.error) {
      unauthorized(res, resolved?.error);
      return;
    }

    const rollNo = String(req.body?.rollNo ?? "")
      .trim()
      .toUpperCase();
    const displayNameRaw = String(req.body?.displayName ?? "").trim();

    if (!ROLL_REGEX.test(rollNo)) {
      res.status(400).json({
        error: "That roll number doesn't look right. Check it and try again.",
      });
      return;
    }
    const displayName = displayNameRaw ? displayNameRaw.slice(0, 40) : null;

    // the roll must exist in the college master table — no ghost registrations
    let student;
    try {
      student = await getStudentCached(rollNo);
    } catch (e) {
      if (e instanceof StudentNotFoundError) {
        res.status(404).json({
          error: "This roll number isn't in the college records yet.",
          suggestions: e.suggestions,
        });
        return;
      }
      throw e;
    }

    await upsertRegistration(resolved.userId, rollNo, displayName);
    trackActivity({
      userId: Number(resolved.userId),
      chatType: "unknown",
      action: "register",
      detail: rollNo,
    });

    res.json({
      ok: true,
      registered: { roll_no: student.roll_no, name: student.name },
    });
  } catch (e) {
    logger.error("[profile] register failed:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
