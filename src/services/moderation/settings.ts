import {
  MODERATION_SETTING_DEFAULTS,
  readModerationSettingRows,
  writeModerationSettingRows,
} from "../../db/chatModeration.model.js";
import { logger } from "../../config/logger.js";

/**
 * The admin's moderation switches, with the defaults and the clamping rules in
 * one place.
 *
 * The bot reads this on every group message, so a successful read is cached
 * for 30 seconds; the panel's save path invalidates the cache immediately, so
 * a switch flips on the next message rather than on the next half-minute.
 */

export interface ModerationSettings {
  /** Master switch for automatic moderation; reply commands ignore it. */
  enabled: boolean;
  /** Delete the offending message. */
  autoDelete: boolean;
  /** Restrict the sender for `muteSeconds`. */
  autoMute: boolean;
  /** Default mute length, also used by a bare /mute. */
  muteSeconds: number;
  /** Post a short self-deleting line in the chat after a removal. */
  noticeInChat: boolean;
  /** Try to DM the muted student the reason. */
  notifyUser: boolean;
}

/** Telegram treats a restriction shorter than 30s as permanent; keep clear. */
export const MUTE_SECONDS_MIN = 60;
/** Longest mute the layer will set: 30 days. */
export const MUTE_SECONDS_MAX = 30 * 24 * 60 * 60;

export const DEFAULT_MODERATION_SETTINGS: Readonly<ModerationSettings> = {
  enabled: true,
  autoDelete: true,
  autoMute: true,
  muteSeconds: 15 * 60,
  noticeInChat: true,
  notifyUser: true,
};

const CACHE_TTL_MS = 30_000;

let cache: { settings: ModerationSettings; at: number } | null = null;

const asBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
};

/** A duration the layer will actually use, in seconds. */
export const clampMuteSeconds = (value: unknown): number => {
  const seconds = Math.trunc(Number(value));
  if (!Number.isFinite(seconds)) return DEFAULT_MODERATION_SETTINGS.muteSeconds;
  return Math.min(Math.max(seconds, MUTE_SECONDS_MIN), MUTE_SECONDS_MAX);
};

/** Merges the stored rows over the defaults; never throws on a bad value. */
export const settingsFromRows = (
  rows: ReadonlyMap<string, string>,
): ModerationSettings => {
  const value = (key: string): string | undefined => rows.get(key);
  const fallback = (key: keyof typeof MODERATION_SETTING_DEFAULTS): string =>
    MODERATION_SETTING_DEFAULTS[key];

  return {
    enabled: asBool(
      value("enabled") ?? fallback("enabled"),
      DEFAULT_MODERATION_SETTINGS.enabled,
    ),
    autoDelete: asBool(
      value("auto_delete") ?? fallback("auto_delete"),
      DEFAULT_MODERATION_SETTINGS.autoDelete,
    ),
    autoMute: asBool(
      value("auto_mute") ?? fallback("auto_mute"),
      DEFAULT_MODERATION_SETTINGS.autoMute,
    ),
    muteSeconds: clampMuteSeconds(
      value("mute_seconds") ?? fallback("mute_seconds"),
    ),
    noticeInChat: asBool(
      value("notice_in_chat") ?? fallback("notice_in_chat"),
      DEFAULT_MODERATION_SETTINGS.noticeInChat,
    ),
    notifyUser: asBool(
      value("notify_user") ?? fallback("notify_user"),
      DEFAULT_MODERATION_SETTINGS.notifyUser,
    ),
  };
};

/** The current switches, cached briefly because the bot reads them per message. */
export const getModerationSettings = async (
  force = false,
): Promise<ModerationSettings> => {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.settings;
  }
  const settings = settingsFromRows(await readModerationSettingRows());
  cache = { settings, at: Date.now() };
  return settings;
};

/** Drops the cache; call after any write from this process. */
export const invalidateModerationSettings = (): void => {
  cache = null;
};

/** Saves only the keys that changed, then forgets the cache. */
export const saveModerationSettings = async (
  patch: Partial<ModerationSettings>,
): Promise<ModerationSettings> => {
  const current = await getModerationSettings(true);
  const next: ModerationSettings = {
    enabled: patch.enabled ?? current.enabled,
    autoDelete: patch.autoDelete ?? current.autoDelete,
    autoMute: patch.autoMute ?? current.autoMute,
    muteSeconds: clampMuteSeconds(patch.muteSeconds ?? current.muteSeconds),
    noticeInChat: patch.noticeInChat ?? current.noticeInChat,
    notifyUser: patch.notifyUser ?? current.notifyUser,
  };

  const rows: Record<string, string> = {};
  if (next.enabled !== current.enabled) rows.enabled = next.enabled ? "1" : "0";
  if (next.autoDelete !== current.autoDelete)
    rows.auto_delete = next.autoDelete ? "1" : "0";
  if (next.autoMute !== current.autoMute)
    rows.auto_mute = next.autoMute ? "1" : "0";
  if (next.muteSeconds !== current.muteSeconds)
    rows.mute_seconds = String(next.muteSeconds);
  if (next.noticeInChat !== current.noticeInChat)
    rows.notice_in_chat = next.noticeInChat ? "1" : "0";
  if (next.notifyUser !== current.notifyUser)
    rows.notify_user = next.notifyUser ? "1" : "0";

  if (Object.keys(rows).length > 0) {
    await writeModerationSettingRows(rows);
    logger.info(
      `[moderation] settings updated: ${Object.keys(rows).join(", ")}`,
    );
  }
  cache = { settings: next, at: Date.now() };
  return next;
};
