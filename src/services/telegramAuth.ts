import crypto from "crypto";
import { TELEGRAM_BOT_TOKEN } from "../config/environmentals.js";

export interface TgInitUser {
  id: number;
  first_name?: string;
  username?: string;
}

/** Telegram doesn't set an expiry; the app enforces one for replay safety. */
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
/** Tolerated clock skew for an initData minted just before our clock ticks. */
const MAX_INIT_DATA_FUTURE_SECONDS = 5 * 60;

/**
 * Compares two hex digests without leaking how much of a guess was right.
 * The length check comes first because timingSafeEqual throws on mismatched
 * buffers; digest lengths are public (always 64 hex chars for SHA-256).
 */
const timingSafeHexEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

/**
 * Validates Telegram WebApp initData per Telegram's spec:
 * HMAC-SHA256(data_check_string, HMAC_SHA256("WebAppData", botToken)).
 * Returns the authenticated user, or null if the signature is missing,
 * invalid, stale (24h replay window), dated more than 5 minutes in the future,
 * or no bot token is configured.
 */
export const verifyInitData = (initData: string): TgInitUser | null => {
  if (!initData || !TELEGRAM_BOT_TOKEN) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secret = crypto
      .createHmac("sha256", "WebAppData")
      .update(TELEGRAM_BOT_TOKEN)
      .digest();
    const computed = crypto
      .createHmac("sha256", secret)
      .update(dataCheckString)
      .digest("hex");
    if (!timingSafeHexEqual(computed, hash)) return null;

    // replay guard: Telegram doesn't expire initData, so enforce a window.
    // A future auth_date is either a clock problem or a forged timestamp:
    // reject it beyond a small skew instead of letting it live for 24h.
    const authDate = Number(params.get("auth_date"));
    if (!Number.isFinite(authDate) || authDate <= 0) return null;
    const ageSeconds = Date.now() / 1000 - authDate;
    if (ageSeconds > MAX_INIT_DATA_AGE_SECONDS) return null;
    if (-ageSeconds > MAX_INIT_DATA_FUTURE_SECONDS) return null;

    const user = JSON.parse(params.get("user") || "null") as TgInitUser | null;
    return user?.id ? user : null;
  } catch {
    return null;
  }
};
