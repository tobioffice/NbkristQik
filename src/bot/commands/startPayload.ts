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
