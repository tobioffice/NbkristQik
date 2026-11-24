import { bot } from "../../bot/bot.js";
import { logger } from "../../config/logger.js";
import {
  clearChatMessages,
  logModerationAction,
  readChatMessageIds,
  removeModeratedUser,
  upsertModeratedUser,
} from "../../db/chatModeration.model.js";
import {
  deleteMessageQuietly,
  deleteMessagesQuietly,
  friendlyTelegramError,
  MUTED_PERMISSIONS,
  UNMUTED_PERMISSIONS,
  telegramErrorText,
} from "./telegram.js";
import { clampMuteSeconds, type ModerationSettings } from "./settings.js";

/**
 * Ban, mute, kick and the history wipe behind them.
 *
 * Two layers, deliberately:
 *  - `apply*` talks to Telegram and throws `ModerationError` with a sentence
 *    the admin can act on. No database writes.
 *  - the exported actions compose a Telegram change, the stored restriction,
 *    the user's message history and one audit line, so the bot's reply
 *    commands and the admin panel cannot drift apart.
 */

/** A moderation call Telegram refused, worded for the admin. */
export class ModerationError extends Error {}

/** Who asked for the action: the group's admin, the panel, or the word list. */
export type ModerationActor = "admin" | "panel" | "auto";

export interface TargetUser {
  id: number;
  firstName?: string | null;
  username?: string | null;
}

export interface ActionResult {
  action: string;
  /** Messages the layer removed from this user's history. */
  deleted: number;
}

export interface BaseAction {
  chatId: number;
  target: TargetUser;
  actor: ModerationActor;
  reason?: string | null;
}

/** What the admin sees the target called in a confirmation line. */
export const targetLabel = (target: TargetUser): string => {
  const name = target.firstName?.trim();
  if (name) return name;
  if (target.username) return `@${target.username}`;
  return String(target.id);
};

const cleanReason = (reason: string | null | undefined): string | null => {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 120) : null;
};

const toModerationError = (error: unknown): ModerationError =>
  new ModerationError(friendlyTelegramError(error));

/** Bans the member; Telegram also drops their messages when it can. */
export const applyBan = async (
  chatId: number,
  userId: number,
): Promise<void> => {
  try {
    await bot.api.banChatMember({
      chat_id: chatId,
      user_id: userId,
      revoke_messages: true,
    });
  } catch (e) {
    throw toModerationError(e);
  }
};

/** Lifts a ban. */
export const applyUnban = async (
  chatId: number,
  userId: number,
): Promise<void> => {
  try {
    await bot.api.unbanChatMember({
      chat_id: chatId,
      user_id: userId,
      only_if_banned: true,
    });
  } catch (e) {
    throw toModerationError(e);
  }
};

/** Restricts the member to read-only until `untilDate` (unix seconds). */
export const applyMute = async (
  chatId: number,
  userId: number,
  untilDate: number,
): Promise<void> => {
  try {
    await bot.api.restrictChatMember({
      chat_id: chatId,
      user_id: userId,
      permissions: MUTED_PERMISSIONS,
      use_independent_chat_permissions: true,
      until_date: untilDate,
    });
  } catch (e) {
    throw toModerationError(e);
  }
};

/** Gives the send rights back. */
export const applyUnmute = async (
  chatId: number,
  userId: number,
): Promise<void> => {
  try {
    await bot.api.restrictChatMember({
      chat_id: chatId,
      user_id: userId,
      permissions: UNMUTED_PERMISSIONS,
      use_independent_chat_permissions: true,
    });
  } catch (e) {
    throw toModerationError(e);
  }
};

/**
 * Deletes every message the bot still remembers from one user in the chat and
 * forgets the trail. `extraIds` covers a message the caller is holding that
 * may not have been logged (an edited message, or one from before the layer).
 */
export const purgeUserMessages = async (
  chatId: number,
  userId: number,
  extraIds: number[] = [],
): Promise<number> => {
  const logged = await readChatMessageIds(chatId, userId);
  const deleted = await deleteMessagesQuietly(chatId, [...logged, ...extraIds]);
  await clearChatMessages(chatId, userId);
  return deleted;
};

const storeRestriction = async (
  action: BaseAction,
  state: "muted" | "banned",
  untilSeconds: number | null,
): Promise<void> => {
  await upsertModeratedUser({
    chatId: action.chatId,
    userId: action.target.id,
    state,
    untilSeconds,
    reason: cleanReason(action.reason),
    actor: action.actor,
    username: action.target.username ?? null,
    firstName: action.target.firstName ?? null,
  });
};

const audit = async (
  action: BaseAction,
  name: string,
  deleted: number,
): Promise<void> => {
  await logModerationAction({
    chatId: action.chatId,
    userId: action.target.id,
    username: action.target.username ?? null,
    firstName: action.target.firstName ?? null,
    action: name,
    reason: cleanReason(action.reason),
    actor: action.actor,
    deletedCount: deleted,
  });
};

/**
 * Bans a member and clears what they said. Telegram's `revoke_messages` does
 * most of the wipe server-side; the remembered ids are the belt and braces
 * for messages it no longer holds.
 */
export const banUser = async (action: BaseAction): Promise<ActionResult> => {
  await applyBan(action.chatId, action.target.id);
  const deleted = await purgeUserMessages(action.chatId, action.target.id);
  await storeRestriction(action, "banned", null);
  await audit(action, "ban", deleted);
  return { action: "ban", deleted };
};

/** Mutes a member for `seconds` and, unless told not to, clears their history. */
export const muteUser = async (
  action: BaseAction & { seconds?: number | null; purge?: boolean },
): Promise<ActionResult & { until: Date }> => {
  const seconds = clampMuteSeconds(action.seconds);
  const until = new Date(Date.now() + seconds * 1000);
  await applyMute(
    action.chatId,
    action.target.id,
    Math.floor(until.getTime() / 1000),
  );
  const deleted =
    action.purge === false
      ? 0
      : await purgeUserMessages(action.chatId, action.target.id);
  await storeRestriction(action, "muted", seconds);
  await audit(action, "mute", deleted);
  return { action: "mute", deleted, until };
};

/**
 * Removes the member from the group without a lasting ban. A kick is a ban
 * followed by an immediate unban; if the unban fails the member stays banned,
 * so the stored state and the audit line say `ban` instead of pretending.
 */
export const kickUser = async (action: BaseAction): Promise<ActionResult> => {
  await applyBan(action.chatId, action.target.id);
  const deleted = await purgeUserMessages(action.chatId, action.target.id);
  try {
    await applyUnban(action.chatId, action.target.id);
  } catch {
    await storeRestriction(action, "banned", null);
    await audit(action, "ban", deleted);
    throw new ModerationError(
      `${targetLabel(action.target)} is banned but Telegram didn't lift it. Unban them from the panel when the rights are fixed.`,
    );
  }
  await removeModeratedUser(action.chatId, action.target.id);
  await audit(action, "kick", deleted);
  return { action: "kick", deleted };
};

/** Lifts a ban and forgets the stored state. */
export const unbanUser = async (action: BaseAction): Promise<ActionResult> => {
  await applyUnban(action.chatId, action.target.id);
  await removeModeratedUser(action.chatId, action.target.id);
  await audit(action, "unban", 0);
  return { action: "unban", deleted: 0 };
};

/** Lifts a mute and forgets the stored state. */
export const unmuteUser = async (action: BaseAction): Promise<ActionResult> => {
  await applyUnmute(action.chatId, action.target.id);
  await removeModeratedUser(action.chatId, action.target.id);
  await audit(action, "unmute", 0);
  return { action: "unmute", deleted: 0 };
};

/** Clears a user's messages without changing their membership. */
export const deleteUserMessages = async (
  action: BaseAction & { extraIds?: number[] },
): Promise<ActionResult> => {
  const deleted = await purgeUserMessages(
    action.chatId,
    action.target.id,
    action.extraIds ?? [],
  );
  await audit(action, "purge", deleted);
  return { action: "purge", deleted };
};

export interface AutoModerationInput {
  chatId: number;
  target: TargetUser;
  /** The message that matched, so it can be removed even if it is unlogged. */
  messageId: number;
  /** The blocked phrases that matched, for the audit line. */
  matched: string[];
  settings: ModerationSettings;
}

export interface AutoModerationResult {
  deleted: boolean;
  muted: boolean;
  muteError: string | null;
}

/**
 * The automatic path: delete the offending message, mute the sender, and write
 * one audit line. A failed mute never hides the deletion, and neither failure
 * is thrown at the update handler — a broken moderation call must not take the
 * bot's other handlers down with it.
 */
export const autoModerate = async (
  input: AutoModerationInput,
): Promise<AutoModerationResult> => {
  const reason = `Blocked word: ${input.matched.join(", ")}`.slice(0, 120);

  const deleted = input.settings.autoDelete
    ? await deleteMessageQuietly(input.chatId, input.messageId)
    : false;

  let muted = false;
  let muteError: string | null = null;
  if (input.settings.autoMute) {
    const seconds = clampMuteSeconds(input.settings.muteSeconds);
    try {
      await applyMute(
        input.chatId,
        input.target.id,
        Math.floor(Date.now() / 1000) + seconds,
      );
      await upsertModeratedUser({
        chatId: input.chatId,
        userId: input.target.id,
        state: "muted",
        untilSeconds: seconds,
        reason,
        actor: "auto",
        username: input.target.username ?? null,
        firstName: input.target.firstName ?? null,
      });
      muted = true;
    } catch (e) {
      muteError = friendlyTelegramError(e);
      logger.warn(
        `[moderation] auto mute ${input.chatId}/${input.target.id} failed:`,
        telegramErrorText(e),
      );
    }
  }

  await logModerationAction({
    chatId: input.chatId,
    userId: input.target.id,
    username: input.target.username ?? null,
    firstName: input.target.firstName ?? null,
    action: muted ? "auto_mute" : "auto_delete",
    reason,
    actor: "auto",
    deletedCount: deleted ? 1 : 0,
  });

  return { deleted, muted, muteError };
};
