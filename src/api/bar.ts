import { Router, type Request, type Response } from "express";
import { logger } from "../config/logger.js";
import {
  renderAttendanceBarPng,
  verifyAttendanceBarToken,
} from "../services/attendanceBar.js";

/**
 * The public bar image used by the rich attendance card.
 *
 * Mounted before the API identity and rate-limit middleware: Telegram's image
 * loader has no initData, and a cached image must not spend a student's API
 * budget. The HMAC in the URL is the gate; the numbers are not sensitive, but
 * the token stops the endpoint becoming a free image generator.
 */
export const barRouter = Router();

barRouter.get("/attendance.png", (req: Request, res: Response) => {
  const pct = typeof req.query.pct === "string" ? req.query.pct : "";
  const target = typeof req.query.target === "string" ? req.query.target : "";
  const token = typeof req.query.t === "string" ? req.query.t : "";

  const percentage = Number(pct);
  const at = Number(target);
  if (
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100 ||
    !Number.isFinite(at) ||
    at < 0 ||
    at > 100 ||
    !verifyAttendanceBarToken(pct, target, token)
  ) {
    res.status(403).json({ success: false, error: "Forbidden" });
    return;
  }

  try {
    const png = renderAttendanceBarPng({ percentage, target: at });
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type("png").send(png);
  } catch (e) {
    logger.error("[bar] image render failed:", e);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});
