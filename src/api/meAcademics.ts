import { Request, Response, Router } from "express";
import { attachedIdentity } from "./resolveUser.js";
import { getRegistration } from "../db/registration.model.js";
import {
  getStudentCached,
  StudentNotFoundError,
} from "../services/redis/utils.js";
import { Academic } from "../services/student.utils/Academic.js";
import { AcademicError } from "../services/student.utils/academicErrors.js";
import { trackActivity } from "../services/tracker.js";
import { logger } from "../config/logger.js";

export const meAcademicsRouter = Router();

type AcademicType = "attendance" | "midmarks";

/**
 * `type` defaults to attendance. Anything else is a 400 rather than a silent
 * attendance response: a client asking for an unknown view should hear about
 * the typo.
 */
const parseType = (value: unknown): AcademicType | null => {
  if (value == null || value === "" || value === "attendance") {
    return "attendance";
  }
  return value === "midmarks" ? "midmarks" : null;
};

/**
 * `source` for the client's "Checked X ago" line:
 *   fallback — the saved section copy (portal unreachable, or last saved copy)
 *   cached   — a recent Redis copy (portal was not checked just now)
 *   live     — a fresh portal response
 */
const freshnessSource = (
  notice: string | null,
): "live" | "cached" | "fallback" => {
  if (!notice) return "live";
  return /could not be reached|last saved/i.test(notice)
    ? "fallback"
    : "cached";
};

/** Map the academic error code to an HTTP status. */
const statusForCode = (code: string): number => {
  switch (code) {
    case "NO_DATA":
      return 404;
    case "SERVER_DOWN":
    case "REPORT_BLOCKED":
      return 503;
    default:
      return 500;
  }
};

/**
 * GET /api/me/academics?type=attendance|midmarks
 *
 * Structured JSON for the "My attendance" screen. The Telegram formatter is
 * deliberately not reused: the app must not parse HTML to render a table.
 *
 * Registration is required. tgusers is the last roll this account looked up
 * (often a friend's), so it is never used as identity here.
 */
meAcademicsRouter.get("/me/academics", async (req: Request, res: Response) => {
  // Private per-caller data; a shared proxy must never key it by URL only.
  res.vary("X-Telegram-Init-Data");
  // Errors are never cached; the success response opts into max-age=60.
  res.set("Cache-Control", "private, no-store");

  let type: AcademicType | null = null;
  let rollNo: string | null = null;

  try {
    const identity = attachedIdentity(req, res);
    if (identity.status === "anonymous") {
      res.status(401).json({
        ok: false,
        registered: false,
        error: "Telegram initData required",
      });
      return;
    }
    if (identity.status === "invalid") {
      res.status(401).json({
        ok: false,
        registered: false,
        error: identity.error,
      });
      return;
    }

    type = parseType(req.query.type);
    if (!type) {
      res.status(400).json({
        ok: false,
        registered: false,
        error: 'type must be "attendance" or "midmarks"',
      });
      return;
    }

    const registration = await getRegistration(identity.userId).catch(
      () => null,
    );
    if (!registration) {
      // Not an error: the app shows "Save your roll" and links to Profile.
      res.json({ ok: false, registered: false });
      return;
    }

    rollNo = registration.roll_no;

    // One event per explicit open. The response is cacheable for 60 s, so a
    // re-render inside the minute does not reach this handler at all.
    trackActivity({
      userId: Number(identity.userId),
      chatType: "unknown",
      action: `${type}_webapp`,
      detail: rollNo,
    });

    // Make sure the roll still exists so a semester rollover gets a clear
    // 404 instead of a parser error from inside Academic.
    await getStudentCached(rollNo);

    const academic = new Academic(rollNo);
    const data =
      type === "attendance"
        ? await academic.getAttendanceJSON()
        : await academic.getMidmarksJSON();

    const notice = academic.getDataNotice();
    res.set("Cache-Control", "private, max-age=60");
    res.json({
      ok: true,
      registered: true,
      type,
      rollNo,
      data,
      freshness: {
        notice,
        source: freshnessSource(notice),
      },
    });
  } catch (error) {
    if (rollNo && error instanceof StudentNotFoundError) {
      res.status(404).json({
        ok: false,
        registered: true,
        type,
        rollNo,
        error: "This roll number isn't in the college records yet.",
        code: "NO_STUDENT",
      });
      return;
    }

    if (rollNo && error instanceof AcademicError) {
      // Expected portal conditions (no data, blocked, down): tell the
      // client what happened with the code it can branch on.
      logger.warn(
        `[me/academics] ${error.code} for ${rollNo}: ${error.message}`,
      );
      res.status(statusForCode(error.code)).json({
        ok: false,
        registered: true,
        type,
        rollNo,
        error: error.message,
        code: error.code,
      });
      return;
    }

    logger.error("[me/academics] failed:", error);
    if (!res.headersSent) {
      res.status(500).json({
        ok: false,
        registered: rollNo != null,
        ...(rollNo ? { rollNo } : {}),
        error: "Internal Server Error",
      });
    }
  }
});
