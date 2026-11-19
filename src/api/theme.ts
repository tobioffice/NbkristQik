import { Router, type Request, type Response } from "express";
import { requireIdentity } from "./resolveUser.js";
import { setUserTheme } from "../db/userSettings.model.js";
import { logger } from "../config/logger.js";

/**
 * The Mini App reports the chat theme once and whenever it changes. The bot
 * uses the background colour to bake the attendance bar strip so it blends in
 * both light and dark chats.
 */
export const themeRouter = Router();

const HEX = /^#[0-9a-f]{6}$/i;

themeRouter.post("/theme", async (req: Request, res: Response) => {
  res.set("Cache-Control", "private, no-store");

  const resolved = requireIdentity(req, res);
  if (!resolved) return;

  const bgColor =
    typeof req.body?.bgColor === "string" ? req.body.bgColor.trim() : "";
  const colorScheme = req.body?.colorScheme === "light" ? "light" : "dark";
  if (!HEX.test(bgColor)) {
    res.status(400).json({ ok: false, error: "bgColor must be #rrggbb" });
    return;
  }

  try {
    await setUserTheme(resolved.userId, bgColor, colorScheme);
    res.json({ ok: true });
  } catch (e) {
    logger.error("[theme] save failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});
