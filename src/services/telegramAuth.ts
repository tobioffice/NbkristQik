import crypto from "crypto";
import { TELEGRAM_BOT_TOKEN } from "../config/environmentals.js";

export interface TgInitUser {
  id: number;
  first_name?: string;
  username?: string;
}

/**
 * Validates Telegram WebApp initData per Telegram's spec:
 * HMAC-SHA256(data_check_string, HMAC_SHA256("WebAppData", botToken)).
 * Returns the authenticated user, or null if the signature is missing,
 * invalid, stale (24h replay window), or no bot token is configured.
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
    if (computed !== hash) return null;

    // replay guard: Telegram doesn't expire initData, so enforce a window
    const authDate = Number(params.get("auth_date"));
    if (!authDate || Date.now() / 1000 - authDate > 24 * 60 * 60) return null;

    const user = JSON.parse(params.get("user") || "null") as TgInitUser | null;
    return user?.id ? user : null;
  } catch {
    return null;
  }
};
