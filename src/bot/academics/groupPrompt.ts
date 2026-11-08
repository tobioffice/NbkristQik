/**
 * The group reply "Your attendance is private…" is disposable: once the
 * student follows its button into the bot, the room no longer needs it, nor
 * the roll message that asked for it. Clearing both keeps a group from
 * filling with roll numbers that look like the bot ignored them.
 *
 * Telegram tells a `/start att_<roll>` who tapped and which roll the payload
 * carried, but not which group message pointed them here. So each prompt is
 * parked under user + roll when it is sent, and taken back out when the deep
 * link lands in private.
 *
 * Best effort by design: this lives in process memory, so a restart (or a
 * message its author already deleted) just leaves it in the group instead of
 * failing the lookup.
 */
export interface GroupPrompt {
  /** The group the prompt sits in. */
  chatId: number;
  /** The prompt's own message id, for `deleteMessage`. */
  messageId: number;
  /** The sender's roll message that the prompt replies to. */
  sourceMessageId: number;
}

/** Telegram refuses deletes past 48 hours, so older prompts are worthless. */
const PROMPT_TTL_MS = 48 * 60 * 60 * 1000;

/** A student retrying a roll must not park an unbounded list of prompts. */
const MAX_PROMPTS = 10;

interface PromptBucket {
  /** When the newest prompt in the bucket was sent. */
  at: number;
  prompts: GroupPrompt[];
}

const buckets = new Map<string, PromptBucket>();

const keyOf = (userId: number, rollNumber: string): string =>
  `${userId}:${rollNumber.trim().toUpperCase()}`;

/** Forgotten prompts are worth nothing: past 48h the delete would fail. */
const sweep = (now: number): void => {
  for (const [key, bucket] of buckets) {
    if (now - bucket.at > PROMPT_TTL_MS) buckets.delete(key);
  }
};

/** Park the prompt a group just received, so the deep link can clear it. */
export const rememberGroupPrompt = (
  userId: number,
  rollNumber: string,
  prompt: GroupPrompt,
  now = Date.now(),
): void => {
  sweep(now);
  const key = keyOf(userId, rollNumber);
  const bucket = buckets.get(key);
  if (!bucket) {
    buckets.set(key, { at: now, prompts: [prompt] });
    return;
  }
  bucket.at = now;
  bucket.prompts.push(prompt);
  if (bucket.prompts.length > MAX_PROMPTS) {
    bucket.prompts.splice(0, bucket.prompts.length - MAX_PROMPTS);
  }
};

/** Take (and forget) the prompts this student is now clearing. */
export const takeGroupPrompts = (
  userId: number,
  rollNumber: string,
  now = Date.now(),
): GroupPrompt[] => {
  const key = keyOf(userId, rollNumber);
  const bucket = buckets.get(key);
  buckets.delete(key);
  if (!bucket || now - bucket.at > PROMPT_TTL_MS) return [];
  return bucket.prompts;
};
