import { ENV } from "./environmentals.js";

const isDev = ENV !== "production";

// Tests and CI are public when the repository is public. Debug output includes
// roll numbers and portal request data, so it stays local-dev-only: production
// already suppresses it, and this also keeps it out of Vitest and Actions.
const isTestOrCi =
  process.env.CI === "true" ||
  process.env.CI === "1" ||
  process.env.NODE_ENV === "test" ||
  process.env.VITEST === "true";
const debugEnabled = isDev && !isTestOrCi;

/**
 * Minimal leveled logger. debug() is local-dev-only so request payloads, roll
 * numbers and cache-hit chatter never leak into public CI or production logs.
 */
export const logger = {
  debug: (...args: unknown[]) => {
    if (debugEnabled) console.log(...args);
  },
  info: (...args: unknown[]) => console.log(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
