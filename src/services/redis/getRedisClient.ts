import { createClient, RedisClientType } from "redis";
import { REDIS_URL } from "../../config/environmentals.js";
import { logger } from "../../utils/logger.js";

let client: RedisClientType | null = null;

export const getClient = async (): Promise<RedisClientType> => {
  if (client) {
    return client;
  }

  client = createClient({
    url: REDIS_URL,
  });

  client.on("error", (err) => logger.error("Redis Client Error", err));

  client.on("connect", () => {
    logger.info("Connected to Redis");
  });

  await client.connect();

  return client;
};
