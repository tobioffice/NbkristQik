/**
 * The payload of a `/start` deep link.
 *
 * Telegram sends `/start <payload>` when a student opens
 * `https://t.me/NbkristQik_bot?start=<payload>`. The channel's "Open the
 * library" button uses `start=library`, so the button lands on the same
 * one-tap library entry as the `/library` command.
 */
export const startPayload = (text: string): string | null => {
  const match = /^\/start(?:\s+(\S+))?/.exec(text);
  return match?.[1] ?? null;
};

/** The prefix the group's "open attendance" link carries. */
const ATTENDANCE_PREFIX = "att_";

/**
 * The roll in an `att_<roll>` payload, or null for another payload.
 *
 * The group reply links to `?start=att_<roll>` so the attended card is one tap
 * away in private. A group can never answer with the card itself.
 */
export const attendanceRoll = (payload: string | null): string | null =>
  payload?.toLowerCase().startsWith(ATTENDANCE_PREFIX)
    ? payload.slice(ATTENDANCE_PREFIX.length)
    : null;
