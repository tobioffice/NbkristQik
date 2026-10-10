import { bot } from "./bot.js";
import { setupBot } from "./setup.js";
import { initDatabase } from "../db/init.js";
import { ADMIN_ID } from "../config/environmentals.js";
import { logger } from "../config/logger.js";

process.on("unhandledRejection", (reason) => {
  logger.error("[bot] unhandled rejection:", reason);
});

logger.info("Starting bot initialization...");

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[bot] ${signal} received, shutting down...`);

  try {
    await bot.stopPolling({ cancel: true });
  } catch {
    /* already stopped */
  }

  try {
    const { getClient } = await import("../services/redis/getRedisClient.js");
    const redis = await getClient();
    await redis.disconnect();
  } catch {
    /* redis may never have connected */
  }

  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

async function startBot() {
  try {
    if (!ADMIN_ID) {
      logger.warn(
        "[config] ADMIN_ID is not set — admin commands (/setsem, /syncdb, report forwarding) are disabled",
      );
    }

    // Ensure every table exists before anything reads or writes it
    await initDatabase();

    // Setup bot commands
    setupBot(bot);

    // Import handler modules — each registers its bot.on* handlers on import
    await Promise.all([
      import("./commands/help.js"),
      import("./commands/start.js"),
      import("./commands/report.js"),
      import("./commands/answers.js"),
      import("./commands/leaderboard.js"),
      import("./commands/register.js"),
      import("./commands/registered.js"),
      import("./academics/academicHandler.js"),
      import("./dailyCheckIn.js"),
      import("./syncdb.js"),
      import("../services/uptime.js"),
      import("../api/server.js"),
    ]);

    const { registerSyncDbCommand } = await import("./syncdb.js");
    registerSyncDbCommand();
    const { startUptimeMonitor } = await import("../services/uptime.js");
    void startUptimeMonitor();
    const { startServer } = await import("../api/server.js");
    startServer();

    // Only expose the bot to Telegram after DB init, all command/handler
    // imports, and the API server are ready.
    await bot.startPolling();

    logger.info("Bot is ready!");
  } catch (error) {
    logger.error("Error during bot initialization:", error);
    process.exit(1);
  }
}

startBot();
