import type { Express, Request, Response } from "express";
import { turso } from "../../db/db.js";
import { logger } from "../../config/logger.js";
import { MODERATION_CHAT_IDS } from "../../config/environmentals.js";
import {
  listBlockedKeywords,
  listModeratedUsers,
  listModerationActions,
  readModerationStats,
} from "../../db/chatModeration.model.js";
import {
  banUser,
  deleteUserMessages,
  kickUser,
  ModerationError,
  muteUser,
  targetLabel,
  unbanUser,
  unmuteUser,
  type TargetUser,
} from "../../services/moderation/actions.js";
import {
  addKeyword,
  KeywordError,
  matchBlockedWords,
  removeKeyword,
} from "../../services/moderation/keywords.js";
import {
  getModerationSettings,
  saveModerationSettings,
  type ModerationSettings,
} from "../../services/moderation/settings.js";
import { getChatSummary } from "../../services/moderation/telegram.js";
import type { RequireAdmin } from "./auth.js";

/**
 * The panel's side of the chat regulation layer.
 *
 * The rule itself is shared with the bot: both call the same service
 * functions, so a panel click and a reply command cannot mean different
 * things. The panel is the place for the slow work (reading the word list,
 * setting the mute length, scanning who is restricted) and for acting on
 * someone whose message is long gone.
 */

const PANEL_ACTIONS = new Set([
  "ban",
  "mute",
  "kick",
  "purge",
  "unban",
  "unmute",
]);

/** The Telegram name recorded for a user the panel is acting on. */
const readTarget = async (userId: number): Promise<TargetUser> => {
  try {
    const result = await turso.execute({
      sql: `SELECT username, first_name FROM botusers WHERE user_id = ?`,
      args: [userId],
    });
    const row = result.rows[0];
    return {
      id: userId,
      username: row?.username ? String(row.username) : null,
      firstName: row?.first_name ? String(row.first_name) : null,
    };
  } catch (e) {
    logger.debug("[admin] moderation target lookup failed:", e);
    return { id: userId };
  }
};

/** The chat a panel action applies to: the requested one or the first. */
const pickChat = (requested: unknown): number => {
  const id = Number(requested);
  if (MODERATION_CHAT_IDS.includes(id)) return id;
  return MODERATION_CHAT_IDS[0];
};

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

/** Mounts the chat-regulation endpoints under the panel's secret base. */
export const registerModerationRoutes = (
  app: Express,
  base: string,
  requireAdmin: RequireAdmin,
): void => {
  app.get(
    `${base}/api/moderation`,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const [settings, keywords, users, actions, counts] = await Promise.all([
          getModerationSettings(true),
          listBlockedKeywords(),
          listModeratedUsers(200),
          listModerationActions(80),
          readModerationStats(),
        ]);
        const chats = await Promise.all(
          MODERATION_CHAT_IDS.map((id) => getChatSummary(id)),
        );
        res.set("Cache-Control", "no-store");
        res.json({
          settings,
          chats,
          keywords: keywords.map((row) => ({
            id: row.id,
            phrase: row.phrase,
            createdAt: row.createdAt,
          })),
          users: users.map((row) => ({
            chatId: row.chatId,
            userId: row.userId,
            state: row.state,
            until: row.untilDate,
            reason: row.reason,
            actor: row.actor,
            username: row.username,
            firstName: row.firstName,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })),
          actions: actions.map((row) => ({
            id: row.id,
            chatId: row.chatId,
            userId: row.userId,
            username: row.username,
            firstName: row.firstName,
            action: row.action,
            reason: row.reason,
            actor: row.actor,
            deleted: row.deletedCount,
            at: row.createdAt,
          })),
          counts,
        });
      } catch (e) {
        logger.error("[admin] moderation load failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  app.post(
    `${base}/api/moderation/settings`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const body = req.body ?? {};
        const patch: Partial<ModerationSettings> = {};
        const enabled = readBoolean(body.enabled);
        const autoDelete = readBoolean(body.autoDelete);
        const autoMute = readBoolean(body.autoMute);
        const noticeInChat = readBoolean(body.noticeInChat);
        const notifyUser = readBoolean(body.notifyUser);
        if (enabled !== undefined) patch.enabled = enabled;
        if (autoDelete !== undefined) patch.autoDelete = autoDelete;
        if (autoMute !== undefined) patch.autoMute = autoMute;
        if (noticeInChat !== undefined) patch.noticeInChat = noticeInChat;
        if (notifyUser !== undefined) patch.notifyUser = notifyUser;

        if (body.muteSeconds !== undefined) {
          const seconds = Number(body.muteSeconds);
          if (!Number.isFinite(seconds)) {
            res.status(400).json({ error: "Mute length must be a number" });
            return;
          }
          patch.muteSeconds = seconds;
        }

        if (Object.keys(patch).length === 0) {
          res.status(400).json({ error: "Nothing to save" });
          return;
        }
        const settings = await saveModerationSettings(patch);
        res.json({ ok: true, settings });
      } catch (e) {
        logger.error("[admin] moderation settings save failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  app.post(
    `${base}/api/moderation/keywords`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const result = await addKeyword(req.body?.phrase);
        res.json({
          ok: true,
          created: result.created,
          keywords: result.active.rows,
        });
      } catch (e) {
        if (e instanceof KeywordError) {
          res.status(400).json({ error: e.message });
          return;
        }
        logger.error("[admin] moderation keyword add failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  app.delete(
    `${base}/api/moderation/keywords/:id`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: "Bad keyword id" });
          return;
        }
        const result = await removeKeyword(id);
        if (!result.removed) {
          res.status(404).json({ error: "Unknown keyword" });
          return;
        }
        res.json({ ok: true, keywords: result.active.rows });
      } catch (e) {
        logger.error("[admin] moderation keyword remove failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  // Dry run: the admin pastes a message and sees which words would catch it.
  app.post(
    `${base}/api/moderation/check`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const text = String(req.body?.text ?? "").slice(0, 2000);
        const hits = await matchBlockedWords(text);
        const settings = await getModerationSettings();
        res.json({
          ok: true,
          hits,
          wouldAct:
            hits.length > 0 &&
            settings.enabled &&
            (settings.autoDelete || settings.autoMute),
        });
      } catch (e) {
        logger.error("[admin] moderation check failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  app.post(
    `${base}/api/moderation/users/:id/:action`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const userId = Number(req.params.id);
        const action = String(req.params.action);
        if (!Number.isInteger(userId) || userId <= 0) {
          res.status(400).json({ error: "Bad user id" });
          return;
        }
        if (!PANEL_ACTIONS.has(action)) {
          res.status(400).json({ error: "Unknown action" });
          return;
        }

        const chatId = pickChat(req.body?.chatId);
        const target = await readTarget(userId);
        const reason = String(req.body?.reason ?? "").slice(0, 120) || null;
        const baseAction = { chatId, target, actor: "panel" as const, reason };

        let result: { action: string; deleted: number };
        switch (action) {
          case "ban":
            result = await banUser(baseAction);
            break;
          case "mute": {
            const settings = await getModerationSettings();
            const seconds = Number(req.body?.seconds ?? settings.muteSeconds);
            result = await muteUser({ ...baseAction, seconds });
            break;
          }
          case "kick":
            result = await kickUser(baseAction);
            break;
          case "purge":
            result = await deleteUserMessages(baseAction);
            break;
          case "unban":
            result = await unbanUser(baseAction);
            break;
          default:
            result = await unmuteUser(baseAction);
            break;
        }

        res.json({
          ok: true,
          action: result.action,
          deleted: result.deleted,
          label: targetLabel(target),
        });
      } catch (e) {
        if (e instanceof ModerationError) {
          res.status(400).json({ error: e.message });
          return;
        }
        logger.error("[admin] moderation user action failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );
};
