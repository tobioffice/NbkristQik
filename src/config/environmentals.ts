import { config } from "dotenv";

config();

// Fail closed: an unset ENV is production. Development and test must say so
// explicitly (a stray production deploy must never inherit dev shortcuts
// such as the unsigned userId identity fallback).
const ENV = process.env.ENV || "production";
const TELEGRAM_BOT_TOKEN =
  ENV === "production"
    ? process.env.TELEGRAM_BOT_TOKEN
    : process.env.TELEGRAM_BOT_TOKEN_DEV || "";
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";
const N_USERNAME = process.env.N_USERNAME || "";
const N_PASSWORD = process.env.N_PASSWORD || "";
const ADMIN_ID = Number(process.env.ADMIN_ID) || 0;
const CHANNEL_ID =
  (ENV === "production"
    ? process.env.PROD_CHANNEL
    : process.env.TEST_CHANNEL) || "";

const REDIS_URL = process.env.REDIS_URL || "";

const PORT = process.env.PORT || 3000;

// Bind loopback by default: production is served through nginx on the same
// host, and a dev box should not expose the API on its LAN address.
const HOST = process.env.HOST?.trim() || "127.0.0.1";

// Shared secret for the private uptime endpoints. The external monitor on
// oracle2 posts heartbeats and reads the deep health check with it. When it
// is unset both endpoints are absent, so a dev box exposes nothing.
const UPTIME_INGEST_SECRET = process.env.UPTIME_INGEST_SECRET?.trim() || "";

// Synthetic answer canary. CANARY_ROLL is a real roll already present in
// studentsnew; the uptime monitor fetches that student's attendance from the
// live portal and parses it. Both the roll and the explicit opt-in must be
// set, so an ordinary dev or test box never calls the college portal.
const CANARY_ROLL = process.env.CANARY_ROLL?.trim() || "";
const CANARY_ENABLED = ["1", "true"].includes(
  (process.env.CANARY_ENABLED || "").trim().toLowerCase(),
);

// The unsigned userId fallback is a development convenience, never a
// production identity. It requires an explicit opt-in (ALLOW_DEV_IDENTITY=1)
// or the test environment; merely running with ENV=development is not
// enough. ENV is fixed at import (dotenv runs once), but the opt-in is read
// per call so tests can prove the gate without re-importing the module.
const allowDevIdentity = (): boolean =>
  ENV === "test" ||
  (process.env.ALLOW_DEV_IDENTITY ?? "").trim().toLowerCase() === "1";

// Secret behind the watermark token. Without it the bot token is used, which
// is secret too, but a dedicated value lets the marks stay stable if the bot
// is ever re-issued. With neither configured, watermark generation throws
// rather than silently falling back to a value printed in this repository.
const LIBRARY_WATERMARK_SECRET =
  process.env.LIBRARY_WATERMARK_SECRET?.trim() || TELEGRAM_BOT_TOKEN || "";

// Comma-separated allowlist for the web leaderboard origin(s). The leaderboard
// is served same-origin from checker.tobioffice.dev now, so the old GitHub
// Pages host is no longer the default; deployments can still override this.
const CORS_ORIGINS = (
  process.env.CORS_ORIGINS || "https://checker.tobioffice.dev"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export {
  ENV,
  TELEGRAM_BOT_TOKEN,
  TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN,
  N_USERNAME,
  N_PASSWORD,
  ADMIN_ID,
  CHANNEL_ID,
  REDIS_URL,
  PORT,
  HOST,
  UPTIME_INGEST_SECRET,
  CANARY_ROLL,
  CANARY_ENABLED,
  CORS_ORIGINS,
  LIBRARY_WATERMARK_SECRET,
  allowDevIdentity,
};
