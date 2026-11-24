/**
 * The reply commands the group's admin uses on a member's message.
 *
 * Reply to the message with `/ban`, and the bot bans that person. They are
 * parsed here, apart from Telegram and the database, so the wording and the
 * duration rules are testable and the handler stays about policy.
 */

import { clampMuteSeconds, MUTE_SECONDS_MIN } from "./settings.js";

/** The reply commands; anything else is an ordinary message. */
export const MODERATION_COMMAND_NAMES = [
  "ban",
  "mute",
  "kick",
  "purge",
  "unban",
  "unmute",
] as const;

export type ModerationCommandName = (typeof MODERATION_COMMAND_NAMES)[number];

const COMMAND_SET = new Set<string>(MODERATION_COMMAND_NAMES);

export interface ModerationCommand {
  name: ModerationCommandName;
  /** Mute length in seconds; null means "use the configured default". */
  seconds: number | null;
  reason: string | null;
}

const COMMAND_RE = /^\/([a-z]+)(?:@[a-z][a-z0-9_]*)?(?:\s+([\s\S]*))?$/i;
const DURATION_RE = /^(\d{1,5})([smhd])?$/i;

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

/**
 * A duration as the admin types it. A bare number is minutes, so `/mute 30`
 * is half an hour; `30s`, `2h` and `1d` are explicit. Returns null when the
 * text is not a duration, so the caller can treat it as the reason instead.
 */
export const parseDuration = (raw: string): number | null => {
  const match = DURATION_RE.exec(raw.trim());
  if (!match) return null;
  const unit = (match[2] ?? "m").toLowerCase();
  const seconds = Number(match[1]) * UNIT_SECONDS[unit];
  if (!Number.isFinite(seconds) || seconds < MUTE_SECONDS_MIN) return null;
  return clampMuteSeconds(seconds);
};

/** "15 minutes", "2 hours", "1 day" — the same words in a reply and the panel. */
export const formatDuration = (rawSeconds: number): string => {
  const seconds = Math.max(1, Math.trunc(rawSeconds));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    if (restMinutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
    return `${hours} hour${hours === 1 ? "" : "s"} ${restMinutes} minute${
      restMinutes === 1 ? "" : "s"
    }`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  if (restHours === 0) return `${days} day${days === 1 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"} ${restHours} hour${
    restHours === 1 ? "" : "s"
  }`;
};

/**
 * Reads a moderation reply command, or null for anything else. The command
 * may carry `@botname` (group clients add it), and everything after the
 * command — or after the duration for `/mute` — is the reason in the log.
 */
export const parseModerationCommand = (
  text: string,
): ModerationCommand | null => {
  const match = COMMAND_RE.exec(text.trim());
  if (!match) return null;

  const name = match[1].toLowerCase();
  if (!COMMAND_SET.has(name)) return null;

  const rest = (match[2] ?? "").trim();
  if (name !== "mute") {
    return {
      name: name as ModerationCommandName,
      seconds: null,
      reason: rest || null,
    };
  }

  const parts = rest.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const seconds = first ? parseDuration(first) : null;
  return {
    name: "mute",
    seconds,
    reason: (seconds == null ? parts : parts.slice(1)).join(" ").trim() || null,
  };
};
