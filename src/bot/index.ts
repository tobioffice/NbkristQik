import { bot } from "./bot.js";
import { setupBot } from "./setup.js";
import { logger } from "../utils/logger.js";

logger.info("Starting bot initialization...");

async function startBot() {
  try {
    // Setup bot commands
    setupBot(bot);

    // Import commands after bot is created
    import("./commands/help.js");
    import("./commands/start.js");
    import("./commands/report.js");
    import("./commands/leaderboard.js");

    // Import features
    import("./academics/academicHandler.js");

    // Start API Server
    import("../api/server.js").then(({ startServer }) => startServer());

    logger.info("Bot is ready!");
  } catch (error) {
    logger.error("Error during bot initialization", error);
    process.exit(1);
  }
}

startBot();
