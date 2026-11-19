import { Router, type Request, type Response } from "express";
import { requireIdentity } from "./resolveUser.js";
import { prepareRankShare, type RankSort } from "../services/rankShare.js";
import { trackActivity } from "../services/tracker.js";
import { logger } from "../config/logger.js";

export const rankRouter = Router();

const sortOf = (raw: unknown): RankSort =>
  raw === "midmarks" ? "midmarks" : "attendance";

/**
 * POST /api/rank/share — a prepared message the Mini App hands to the
 * student's native share sheet. The message itself is stored by Telegram and
 * only ever sent by the student, to a chat they pick.
 */
rankRouter.post("/rank/share", async (req: Request, res: Response) => {
  res.set("Cache-Control", "private, no-store");
  try {
    const resolved = requireIdentity(req, res);
    if (!resolved) return;

    const userId = Number(resolved.userId);
    const sort = sortOf(req.body?.sort);
    const prepared = await prepareRankShare(userId, sort);

    if (!prepared.ok) {
      res.status(prepared.status).json({ ok: false, error: prepared.error });
      return;
    }

    trackActivity({
      userId,
      username: resolved.user?.username,
      firstName: resolved.user?.first_name,
      chatType: "unknown",
      action: "rank_share",
      detail: sort,
    });

    res.json({ ok: true, ...prepared.share });
  } catch (e) {
    logger.error("[rank] share preparation failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});
