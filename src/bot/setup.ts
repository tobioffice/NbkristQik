import TelegramBot from "node-telegram-bot-api";

export function setupBot(bot: TelegramBot): void {
   bot.setMyCommands([
      { command: "/start", description: "Start the bot" },
      { command: "/report", description: "Report an issue" },
      { command: `/help`, description: "Get help" },
   ]);
}
