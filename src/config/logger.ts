import { ENV } from "./environmentals.js";

const isDev = ENV !== "production";

/**
 * Minimal leveled logger. debug() is dev-only so request payloads and
 * cache-hit chatter never leak into production logs.
 */
export const logger = {
  debug: (...args: unknown[]) => {
    if (isDev) console.log(...args);
  },
  info: (...args: unknown[]) => console.log(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
