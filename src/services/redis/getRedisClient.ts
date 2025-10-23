import { createClient, RedisClientType } from "redis";

let client: RedisClientType | null = null;

export const getClient = async (): Promise<RedisClientType> => {
  if (client) {
    return client;
  }

  client = createClient({
    url: process.env.REDIS_URL,
  });

  client.on("error", (err) => console.error("Redis Client Error", err));

  client.on("connect", () => {
    console.log("Connected to Redis");
  });

  await client.connect();

  return client;
};

export const closeClient = async (): Promise<void> => {
  if (client) {
    await client.quit();
    client = null;
    console.log("Redis connection closed");
  }
};
