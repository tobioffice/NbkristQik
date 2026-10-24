/**
 * The lines the bot repeats.
 *
 * These four sentences are sent from more than one place, and a student who
 * trips two of them in one minute should read the same words both times. They
 * live here so a change to the voice is one edit, not five.
 */

/** Rate limit hit on a command or a button. */
export const TOO_FAST = "Too fast for me. Try again in a minute.";

/** Something threw behind a handler; the student gets a plain apology. */
export const SOMETHING_BROKE =
  "Something broke on my side. Try again in a bit.";

/** A roll number that fails the format check. */
export const BAD_ROLL =
  "That roll number doesn't look right. Check it and send it again.";

/** The gate a student meets before the bot will answer them. */
export const CHECK_IN_PROMPT =
  "🔓 <b>Quick human check</b>\n\nTap <b>\"I'm not a robot\"</b> below and you're in.";

/** The channel the bot asks students to join, before it answers. */
export const JOIN_CHANNEL =
  "I need you in the channel first, then I can help you here.";
