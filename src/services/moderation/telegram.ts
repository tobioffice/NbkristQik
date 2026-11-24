import {
  TelegramApiError,
  type ChatMemberAdministrator,
  type ChatPermissions,
} from "node-telegram-bot-api";
import { bot } from "../../bot/bot.js";
import { logger } from "../../config/logger.js";

/**
 * The Telegram calls the regulation layer makes, and their failure modes.
 *
 * Kept apart from the policy in `actions.ts` so the permission objects, the
 * cache for "is this person a group admin" and the delete-in-bulk retry are
 * testable and described once.
 */

/** A group admin check, or null when Telegram could not answer. */
type AdminLookup = { value: boolean | null; at: number };

const ADMIN_CACHE_TTL_MS = 60_000;
const adminCache = new Map<string, AdminLookup>();

/** What the panel shows about the bot's own rights in one chat. */
export interface BotRights {
  isAdmin: boolean;
  canDelete: boolean;
  canRestrict: boolean;
  error: string | null;
}

/** The public facts about a regulated chat, for the panel's status rows. */
export interface ChatSummary {
  id: number;
  title: string;
  username: string | null;
  type: string;
  memberCount: number | null;
  bot: BotRights;
}

/** Everything a muted member may not do; nothing else is touched. */
export const MUTED_PERMISSIONS: ChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_react_to_messages: false,
};

/** The send rights a lifted mute gives back. */
export const UNMUTED_PERMISSIONS: ChatPermissions = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_react_to_messages: true,
};

const pruneAdminCache = (now: number): void => {
  if (adminCache.size <= 1000) return;
  for (const [key, entry] of adminCache) {
    if (now - entry.at > ADMIN_CACHE_TTL_MS) adminCache.delete(key);
  }
};

/** The bot's own user id, fetched once and kept for the process lifetime. */
let ownUserId: number | null = null;
export const botUserId = async (): Promise<number | null> => {
  if (ownUserId != null) return ownUserId;
  const cached = bot.botInfo?.id;
  if (cached) {
    ownUserId = cached;
    return ownUserId;
  }
  try {
    const me = await bot.api.getMe();
    ownUserId = me.id;
    return ownUserId;
  } catch (e) {
    logger.warn("[moderation] getMe failed:", telegramErrorText(e));
    return null;
  }
};

/**
 * Whether this member can act as a group admin.
 *
 * True for the creator and administrators; false for everyone else; null when
 * Telegram could not answer. The moderation handler treats null as "leave
 * them alone" — a failed lookup must never mute the wrong person.
 */
export const isChatAdmin = async (
  chatId: number,
  userId: number,
): Promise<boolean | null> => {
  const now = Date.now();
  pruneAdminCache(now);
  const key = `${chatId}:${userId}`;
  const hit = adminCache.get(key);
  if (hit && now - hit.at < ADMIN_CACHE_TTL_MS) return hit.value;

  let value: boolean | null;
  try {
    const member = await bot.api.getChatMember({
      chat_id: chatId,
      user_id: userId,
    });
    value = member.status === "creator" || member.status === "administrator";
  } catch (e) {
    logger.warn(
      `[moderation] getChatMember ${chatId}/${userId} failed:`,
      telegramErrorText(e),
    );
    value = null;
  }
  adminCache.set(key, { value, at: now });
  return value;
};

/** Drops a cached admin answer; used when a member's role changes. */
export const invalidateChatAdmin = (chatId: number, userId: number): void => {
  adminCache.delete(`${chatId}:${userId}`);
};

/** What the bot itself may do in a chat, for the panel's status rows. */
const readBotRights = async (chatId: number): Promise<BotRights> => {
  const id = await botUserId();
  if (id == null) {
    return {
      isAdmin: false,
      canDelete: false,
      canRestrict: false,
      error: "Telegram did not answer getMe.",
    };
  }
  try {
    const member = await bot.api.getChatMember({
      chat_id: chatId,
      user_id: id,
    });
    if (member.status === "creator") {
      return {
        isAdmin: true,
        canDelete: true,
        canRestrict: true,
        error: null,
      };
    }
    if (member.status === "administrator") {
      const admin = member as ChatMemberAdministrator;
      return {
        isAdmin: true,
        canDelete: admin.can_delete_messages,
        canRestrict: admin.can_restrict_members,
        error: null,
      };
    }
    return {
      isAdmin: false,
      canDelete: false,
      canRestrict: false,
      error: "The bot is in the group but is not an admin.",
    };
  } catch (e) {
    return {
      isAdmin: false,
      canDelete: false,
      canRestrict: false,
      error: friendlyTelegramError(e),
    };
  }
};

/**
 * The facts the panel shows for one chat. Cached for a minute: the panel polls
 * and these change rarely, and Telegram rate-limits chat lookups.
 */
const CHAT_CACHE_TTL_MS = 60_000;
const chatCache = new Map<number, { summary: ChatSummary; at: number }>();

export const getChatSummary = async (chatId: number): Promise<ChatSummary> => {
  const hit = chatCache.get(chatId);
  if (hit && Date.now() - hit.at < CHAT_CACHE_TTL_MS) return hit.summary;

  const [chat, count, rights] = await Promise.all([
    bot.api.getChat({ chat_id: chatId }).catch(() => null),
    bot.api.getChatMemberCount({ chat_id: chatId }).catch(() => null),
    readBotRights(chatId),
  ]);

  const summary: ChatSummary = {
    id: chatId,
    title: chat?.title ?? `Chat ${chatId}`,
    username: chat?.username ?? null,
    type: chat?.type ?? "group",
    memberCount: count,
    bot: rights,
  };
  chatCache.set(chatId, { summary, at: Date.now() });
  return summary;
};

/** Forgets the cached chat facts; used by the panel's refresh action. */
export const invalidateChatSummary = (chatId: number): void => {
  chatCache.delete(chatId);
};

/** Deletes one message, swallowing the expected "already gone" failures. */
export const deleteMessageQuietly = async (
  chatId: number,
  messageId: number,
): Promise<boolean> => {
  try {
    await bot.api.deleteMessage({ chat_id: chatId, message_id: messageId });
    return true;
  } catch (e) {
    logger.debug(
      `[moderation] delete ${chatId}/${messageId} skipped:`,
      telegramErrorText(e),
    );
    return false;
  }
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

/** The maximum number of ids one purge will try, as a runaway guard. */
const MAX_PURGE_IDS = 500;

/**
 * Deletes as many of these messages as Telegram allows and returns how many
 * went. One failed batch falls back to one-at-a-time, because a single
 * too-old message would otherwise sink the other 99 in its batch.
 */
export const deleteMessagesQuietly = async (
  chatId: number,
  messageIds: number[],
): Promise<number> => {
  const ids = [...new Set(messageIds)]
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, MAX_PURGE_IDS);
  if (ids.length === 0) return 0;

  let deleted = 0;
  for (const batch of chunk(ids, 100)) {
    try {
      await bot.api.deleteMessages({
        chat_id: chatId,
        message_ids: batch,
      });
      deleted += batch.length;
      continue;
    } catch (e) {
      logger.debug(
        `[moderation] bulk delete ${chatId} (${batch.length}) failed, retrying one by one:`,
        telegramErrorText(e),
      );
    }
    for (const id of batch) {
      if (await deleteMessageQuietly(chatId, id)) deleted += 1;
    }
  }
  return deleted;
};

/** The error text of any thrown value, without a stack or a request URL. */
export const telegramErrorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * A sentence the admin can act on. Telegram's raw description ("Bad Request:
 * not enough rights to restrict/unrestrict chat member") is a log line, not a
 * panel message.
 */
export const friendlyTelegramError = (error: unknown): string => {
  const description =
    error instanceof TelegramApiError
      ? error.description
      : telegramErrorText(error);
  const lower = description.toLowerCase();

  if (
    /not enough rights|have no rights|need administrator|chat_admin_required|not enough rights to/.test(
      lower,
    )
  ) {
    return "The bot doesn't have the rights for that here. Make it an admin with delete and restrict permissions.";
  }
  if (/administrator|admin_invalid|can't remove/.test(lower)) {
    return "That person is a group admin. Telegram won't let me restrict an admin.";
  }
  if (/chat not found|bot is not a member/.test(lower)) {
    return "I can't reach that group. Check that the bot is still a member.";
  }
  if (/not found|participant not found|member not found/.test(lower)) {
    return "That user isn't in this group.";
  }
  return description.replace(/^bad request:\s*/i, "");
};
