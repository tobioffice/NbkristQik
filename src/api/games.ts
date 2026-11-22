import { Router, type Request, type Response } from "express";
import { logger } from "../config/logger.js";
import {
  getSectionTopPlayers,
  getWeekPlayers,
  getWeekSections,
} from "../db/game.model.js";
import { getHiddenRolls } from "../db/rollClaim.model.js";
import { weekLabel } from "../games/cards.js";
import { seasonKey } from "../games/config.js";
import { maskRoll } from "../games/scoring.js";
import type { BoardPlayer } from "../games/types.js";
import { istStamp } from "../games/time.js";
import { attachedIdentity } from "./resolveUser.js";

/**
 * The league's public board, for the page the channel's "Full leaderboard"
 * button opens.
 *
 * The page shows the full roll next to a chosen display name. The one
 * exception is a verified owner's hide-in-the-leaderboard switch: that roll
 * stays masked, exactly as the academic register treats it. The portal name
 * is never printed. The page is a wider view than the channel's top three —
 * the week's top ten players and every section that has scored — so it reads
 * straight from the weekly boards.
 */

const PLAYER_LIMIT = 10;
/** Section Wars has one row per section that scored; the board clamps at 100. */
const SECTION_LIMIT = 100;
/** Only the leading section shows its stars, so the page stays a board. */
const LEADER_PLAYER_LIMIT = 3;

interface PublicPlayer {
  /** The chosen display name, or the roll when there is none. */
  name: string;
  /** The full roll, or the masked one when its owner hid the leaderboard. */
  roll: string;
  points: number;
}

export const gamesRouter = Router();

gamesRouter.get("/games/board", async (req: Request, res: Response) => {
  try {
    // The payload is public, but a presented-and-invalid signature is still a
    // 401: a broken Telegram client must not silently look anonymous.
    const identity = attachedIdentity(req, res);
    if (identity.status === "invalid") {
      res.status(401).json({ success: false, error: identity.error });
      return;
    }

    const stamp = istStamp();
    const season = seasonKey();
    const [players, sections] = await Promise.all([
      getWeekPlayers(season, stamp.week, PLAYER_LIMIT),
      getWeekSections(season, stamp.week, SECTION_LIMIT),
    ]);

    // The page shows the top section's three players as the detail on the
    // sections board, so that answer is resolved here, not on the phone.
    const leader = sections[0] ?? null;
    const leadingPlayers = leader
      ? await getSectionTopPlayers(
          season,
          stamp.week,
          leader.key,
          LEADER_PLAYER_LIMIT,
        )
      : [];

    // A verified owner can hide their row; only that roll stays masked.
    const hidden = await getHiddenRolls([
      ...players.map((player) => player.rollNo),
      ...leadingPlayers.map((player) => player.rollNo),
    ]);

    const publicPlayer = (player: BoardPlayer): PublicPlayer => {
      // The owner asked to stay off the public leaderboard: mask the roll,
      // and fall back to it for the name as before.
      const roll = hidden.has(player.rollNo.toUpperCase())
        ? maskRoll(player.rollNo)
        : player.rollNo.toUpperCase();
      return {
        name: player.displayName?.trim() || roll,
        roll,
        points: player.points,
      };
    };

    // Anonymous callers share one payload, so it may sit in a cache briefly;
    // the boards only move when a run or a duel finishes.
    res.set("Cache-Control", "public, max-age=30");
    res.json({
      success: true,
      season,
      week: stamp.week,
      weekLabel: weekLabel(stamp.monday),
      players: players.map(publicPlayer),
      sections: sections.map((section, index) => ({
        label: section.label,
        points: section.points,
        players: section.players,
        // Only the number-one section carries its top three players.
        ...(index === 0
          ? { topPlayers: leadingPlayers.map(publicPlayer) }
          : {}),
      })),
    });
  } catch (e) {
    logger.error("[games] board read failed:", e);
    res.set("Cache-Control", "no-store");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});
