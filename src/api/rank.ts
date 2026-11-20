import express, { Router, type Request, type Response } from "express";
import { InputFile } from "node-telegram-bot-api";
import { requireIdentity } from "./resolveUser.js";
import {
  prepareRankShare,
  type RankScope,
  type RankSort,
} from "../services/rankShare.js";
import {
  getRankCard,
  getRankCardForUser,
  putRankCard,
} from "../services/rankCardStore.js";
import { bot } from "../bot/bot.js";
import { appPageButton } from "../bot/appButton.js";
import { trackActivity } from "../services/tracker.js";
import { logger } from "../config/logger.js";

export const rankRouter = Router();

/** The card the phone draws is 1080×1920 JPEG; 1.5 MB is generous. */
const MAX_RANK_CARD_BYTES = Math.floor(1.5 * 1024 * 1024);

const sortOf = (raw: unknown): RankSort =>
  raw === "midmarks" ? "midmarks" : "attendance";

const scopeOf = (raw: unknown): RankScope =>
  raw === "section" ? "section" : "all";

const isJpeg = (bytes: Buffer): boolean =>
  bytes.length >= 4 &&
  bytes[0] === 0xff &&
  bytes[1] === 0xd8 &&
  bytes[2] === 0xff;

/**
 * POST /api/rank/share — a prepared message the Mini App hands to the
 * student's native share sheet. The message itself is stored by Telegram and
 * only ever sent by the student, to a chat they pick.
 *
 * The rank is resolved here for the requested board, never taken from the
 * client. A card id is accepted only when it is the caller's current card.
 */
rankRouter.post("/rank/share", async (req: Request, res: Response) => {
  res.set("Cache-Control", "private, no-store");
  try {
    const resolved = requireIdentity(req, res);
    if (!resolved) return;

    const userId = Number(resolved.userId);
    const sort = sortOf(req.body?.sort);
    const scope = scopeOf(req.body?.scope);

    const cardId =
      typeof req.body?.cardId === "string" ? req.body.cardId : null;
    const current = cardId ? getRankCardForUser(resolved.userId) : null;
    const cardUrl = current && current.id === cardId ? current.url : null;

    const prepared = await prepareRankShare(userId, sort, { scope, cardUrl });

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
      detail: `${sort}:${scope}:${cardUrl ? "card" : "text"}`,
    });

    res.json({ ok: true, ...prepared.share });
  } catch (e) {
    logger.error("[rank] share preparation failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

/**
 * POST /api/rank/card — the phone's drawn 1080×1920 JPEG.
 *
 * Telegram fetches media server-side, so the card needs a public URL. The
 * upload is identity-gated, JPEG-only and replaces the caller's previous
 * card; the store expires it after thirty minutes.
 */
rankRouter.post(
  "/rank/card",
  express.raw({ type: "image/jpeg", limit: "1.5mb" }),
  async (req: Request, res: Response) => {
    res.set("Cache-Control", "private, no-store");
    try {
      const resolved = requireIdentity(req, res);
      if (!resolved) return;

      const bytes: unknown = req.body;
      if (!Buffer.isBuffer(bytes) || !isJpeg(bytes)) {
        res.status(415).json({
          ok: false,
          error: "The rank card needs to be a JPEG image.",
        });
        return;
      }
      if (bytes.length > MAX_RANK_CARD_BYTES) {
        res.status(413).json({
          ok: false,
          error: "That rank card is too large.",
        });
        return;
      }

      const baseUrl = `${req.protocol}://${req.get("host") ?? "localhost"}`;
      const card = putRankCard({
        userId: resolved.userId,
        bytes,
        baseUrl,
      });

      trackActivity({
        userId: Number(resolved.userId),
        username: resolved.user?.username,
        firstName: resolved.user?.first_name,
        chatType: "unknown",
        action: "rank_card",
        detail: "upload",
      });

      res.json({ ok: true, ...card });
    } catch (e) {
      logger.error("[rank] card upload failed:", e);
      res.status(500).json({ ok: false, error: "Internal Server Error" });
    }
  },
);

/**
 * POST /api/rank/card/send — the reliable Instagram hand-off.
 *
 * Telegram webviews do not implement the Web Share API, so the card is sent
 * to the caller's own chat; a long-press there saves it to Photos, and
 * Instagram's story editor can pick it up. Only the caller's chat, and only
 * their current card.
 */
rankRouter.post("/rank/card/send", async (req: Request, res: Response) => {
  res.set("Cache-Control", "private, no-store");
  try {
    const resolved = requireIdentity(req, res);
    if (!resolved) return;

    const cardId = typeof req.body?.cardId === "string" ? req.body.cardId : "";
    const card = getRankCard(cardId);
    if (!card || card.userId !== resolved.userId) {
      res.status(404).json({ ok: false, error: "That rank card has expired." });
      return;
    }

    const userId = Number(resolved.userId);
    try {
      await bot.api.sendPhoto({
        chat_id: userId,
        photo: new InputFile(card.bytes, {
          filename: "nbkristqik-rank.jpg",
          contentType: "image/jpeg",
        }),
        caption: "Your rank card. Long-press it to save it to your photos.",
        disable_notification: true,
        reply_markup: {
          inline_keyboard: [[appPageButton("Open the register", "rank", true)]],
        },
      });
    } catch (e) {
      logger.warn(
        "[rank] could not send the card to the caller:",
        e instanceof Error ? e.message : e,
      );
      res.status(502).json({
        ok: false,
        error: "Telegram could not send the card. Try again.",
      });
      return;
    }

    trackActivity({
      userId,
      username: resolved.user?.username,
      firstName: resolved.user?.first_name,
      chatType: "unknown",
      action: "rank_card_send",
      detail: "save",
    });

    res.json({ ok: true });
  } catch (e) {
    logger.error("[rank] card send failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});
