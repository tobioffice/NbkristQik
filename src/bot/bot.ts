import TelegramBot from "node-telegram-bot-api";
import { TELEGRAM_BOT_TOKEN, PORT } from "../config/environmentals.js";
import express from "express";

const TOKEN = TELEGRAM_BOT_TOKEN || "";

export const bot = new TelegramBot(TOKEN);

const url = "https://librarypro.tobioffice.dev";
const port = PORT || 5000;

bot.setWebHook(`${url}/bot${TOKEN}`);

const app = express();

app.use(express.json());

app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(port, () => {
  console.log(`Express server is listening on ${port}`);
});

// For DEVELOPMENT
// import TelegramBot from "node-telegram-bot-api";
// import { TELEGRAM_BOT_TOKEN } from "../config/environmentals.js";

// const token = TELEGRAM_BOT_TOKEN || "";

// export const bot = new TelegramBot(token, { polling: true });
