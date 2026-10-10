import { createClient } from "redis";
import { REDIS_URL } from "../../config/environmentals.js";
import { logger } from "../../config/logger.js";

// Cache the connect promise, not the client: concurrent first callers get a
// single client (no double connect), and a failed connect isn't pinned —
// the next caller retries.
let clientPromise: ReturnType<typeof createRedisClient> | null = null;

// After a failed connect, callers fall back to Turso/portal for a short
// cooldown instead of re-paying the full reconnect timeout on every request.
const RETRY_COOLDOWN_MS = 30_000;
let lastFailureAt = 0;

async function createRedisClient() {
  const client = createClient({
    url: REDIS_URL,
    // bound the reconnect loop: if Redis stays down, connect() settles with
    // an error so callers can fall back (e.g. leaderboard serves from DB)
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 3) {
          return new Error("Redis unreachable after 4 reconnect attempts");
        }
        return Math.min(retries * 200, 1000);
      },
    },
  });

  client.on("error", (err) => logger.error("Redis Client Error", err));
  client.on("connect", () => {
    logger.info("Connected to Redis");
  });

  await client.connect();
  return client;
}

export const getClient = () => {
  // fast-fail during the cooldown so a down Redis doesn't add its full
  // reconnect timeout to every request
  if (!clientPromise && Date.now() - lastFailureAt < RETRY_COOLDOWN_MS) {
    return Promise.reject(new Error("Redis connect in cooldown after failure"));
  }
  clientPromise ??= createRedisClient();
  const promise = clientPromise;
  // If the initial connect fails, clear the rejected promise so the next
  // caller retries instead of reusing the same failure forever.
  void promise.catch(() => {
    if (clientPromise === promise) {
      clientPromise = null;
      lastFailureAt = Date.now();
    }
  });
  return promise;
};
