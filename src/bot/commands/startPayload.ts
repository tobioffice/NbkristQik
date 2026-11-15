/** The cards a group's private link can open. */
export type DeepLinkSignal = "att" | "mid" | "bunk";

const SIGNALS: DeepLinkSignal[] = ["att", "mid", "bunk"];

export interface DeepLink {
  signal: DeepLinkSignal;
  /** The roll as typed into the link; the caller normalises it. */
  roll: string;
}

/**
 * The card and roll in an `att_<roll>` / `mid_<roll>` / `bunk_<roll>` start
 * payload, or null for another payload.
 *
 * The group reply links to `?start=<signal>_<roll>` so the card is one tap
 * away in private. A group can never answer with the card itself. The payload
 * arrives as `ctx.match` from `bot.command("start")`.
 */
export const deepLink = (payload: string | null): DeepLink | null => {
  if (!payload) return null;

  const lower = payload.toLowerCase();
  const signal = SIGNALS.find((candidate) => lower.startsWith(`${candidate}_`));
  if (!signal) return null;

  return { signal, roll: payload.slice(signal.length + 1) };
};
