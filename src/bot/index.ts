import { bot } from "./bot.js";
import { setupBot } from "./setup.js";

console.log("Starting bot initialization...");

async function startBot() {
  try {
    // Setup bot commands
    setupBot(bot);

    // Import commands after bot is created
    import("./commands/help.js");
    import("./commands/start.js");
    import("./commands/report.js");

    // Import features
    import("./features/bot.academic.js");

    console.log("Bot is ready!");
  } catch (error) {
    console.error("Error during bot initialization:", error);
    process.exit(1);
  }
}

startBot();
