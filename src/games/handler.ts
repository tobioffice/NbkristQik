import { bot } from "../bot/bot.js";
import type { Context, Message } from "node-telegram-bot-api";
import { getAttempt, getDuel } from "../db/game.model.js";
import { isAuthorizedUser } from "../bot/authorization.js";
import { botSecurityHandler } from "../middleware/security.js";
import { TOO_FAST, SOMETHING_BROKE } from "../bot/replies.js";
import { botLink } from "../constants/telegram.js";
import { logger } from "../config/logger.js";
import { trackMessage } from "../services/tracker.js";
import { startDailyFive, finishFive, showFiveResult } from "./five.js";
import {
  createDuelFromAttempt,
  finishDuelAttempt,
  sendDuelRecord,
  showDuelResult,
  startDuel,
} from "./duel.js";
import { sendLeague } from "./league.js";
import { recordAnswer, showQuestion } from "./play.js";

/**
 * Commands and callbacks for the league.
 *
 * The commands are private. A group that asks gets a deep link instead, the
 * same rule the attendance cards follow: no personal figure in a room that
 * forwards.
 */

const say = async (chatId: number, text: string): Promise<void> => {
  await bot.api.sendMessage({ chat_id: chatId, text, parse_mode: "HTML" });
};

const privateLink = async (
  msg: Message,
  text: string,
  payload: string,
  label: string,
): Promise<boolean> => {
  if (msg.chat.type === "private") return false;
  await bot.api.sendMessage({
    chat_id: msg.chat.id,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: label, url: botLink(payload) }]],
    },
  });
  return true;
};

const gate = async (msg: Message, action: string): Promise<number | null> => {
  const userId = msg.from?.id;
  if (!userId) return null;

  if (!(await botSecurityHandler(userId, action))) {
    await say(msg.chat.id, TOO_FAST);
    return null;
  }

  const authorized = await isAuthorizedUser({
    userId,
    chatId: msg.chat.id,
  });
  if (!authorized) return null;

  return userId;
};

const fail = async (
  chatId: number,
  label: string,
  error: unknown,
): Promise<void> => {
  logger.error(`[games] ${label} failed:`, error);
  await say(chatId, SOMETHING_BROKE).catch(() => undefined);
};

const openFive = async (msg: Message): Promise<void> => {
  if (
    await privateLink(
      msg,
      "Today's run is private. Tap below to play.",
      "quiz",
      "Open in private",
    )
  ) {
    return;
  }

  const userId = await gate(msg, "game");
  if (!userId) return;

  trackMessage(msg, "command:quiz");
  await startDailyFive({
    chatId: msg.chat.id,
    userId,
    replyTo: msg.message_id,
  });
};

const openLeague = async (msg: Message): Promise<void> => {
  if (
    await privateLink(
      msg,
      "The board is in the private chat. Tap below to open it.",
      "league",
      "Open the board",
    )
  ) {
    return;
  }

  const userId = await gate(msg, "game");
  if (!userId) return;

  trackMessage(msg, "command:league");
  await sendLeague({ chatId: msg.chat.id, userId, replyTo: msg.message_id });
};

const openDuel = async (msg: Message): Promise<void> => {
  if (
    await privateLink(
      msg,
      "Duels are private. Tap below to see yours.",
      "duel",
      "Open duels",
    )
  ) {
    return;
  }

  const userId = await gate(msg, "game");
  if (!userId) return;

  trackMessage(msg, "command:duel");
  await sendDuelRecord({
    chatId: msg.chat.id,
    userId,
    replyTo: msg.message_id,
  });
};

bot.command("quiz", (ctx) => {
  const msg = ctx.message;
  if (!msg) return;
  return openFive(msg).catch((e) => fail(msg.chat.id, "quiz", e));
});

bot.command("league", (ctx) => {
  const msg = ctx.message;
  if (!msg) return;
  return openLeague(msg).catch((e) => fail(msg.chat.id, "league", e));
});

bot.command("duel", (ctx) => {
  const msg = ctx.message;
  if (!msg) return;
  return openDuel(msg).catch((e) => fail(msg.chat.id, "duel", e));
});

/** The `/start=quiz` payload; old `/start=five` links still land here. */
export const startFiveFromMessage = async (msg: Message): Promise<void> => {
  if (
    await privateLink(
      msg,
      "Today's run is private. Tap below to play.",
      "quiz",
      "Open in private",
    )
  ) {
    return;
  }

  const userId = await gate(msg, "game");
  if (!userId) return;
  await startDailyFive({
    chatId: msg.chat.id,
    userId,
    replyTo: msg.message_id,
  });
};

/** The `/start=duel_<id>` payload. */
export const startDuelFromMessage = async (
  msg: Message,
  duelId: number,
): Promise<void> => {
  if (
    await privateLink(
      msg,
      "Challenges are private. Tap below to open it.",
      `duel_${duelId}`,
      "Open the challenge",
    )
  ) {
    return;
  }

  const userId = await gate(msg, "game");
  if (!userId) return;
  await startDuel({
    chatId: msg.chat.id,
    userId,
    duelId,
    replyTo: msg.message_id,
  });
};

/** The `/start=league` payload. */
export const startLeagueFromMessage = async (msg: Message): Promise<void> => {
  if (
    await privateLink(
      msg,
      "The board is in the private chat. Tap below to open it.",
      "league",
      "Open the board",
    )
  ) {
    return;
  }

  const userId = await gate(msg, "game");
  if (!userId) return;
  await sendLeague({ chatId: msg.chat.id, userId, replyTo: msg.message_id });
};

/** True for callback data this module owns. */
export const isGameCallback = (data: string): boolean =>
  data === "five_play" ||
  data === "league_show" ||
  /^q5_\d+_\d+_\d+$/.test(data) ||
  /^duel_new_\d+$/.test(data);

/**
 * The game half of the callback dispatcher.
 *
 * The academic handler has already paid the rate limit and the channel gate;
 * this function still checks that the card belongs to the person tapping it.
 */
export const handleGameCallback = async (ctx: Context): Promise<void> => {
  const callback = ctx.callbackQuery;
  const msg = callback?.message;
  if (!callback || !msg) return;

  const userId = callback.from?.id;
  if (!userId) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    return;
  }

  if (msg.chat.type !== "private") {
    await ctx
      .answerCallbackQuery({
        text: "That card is private now. Open the bot to play.",
        show_alert: true,
      })
      .catch(() => undefined);
    return;
  }

  const data = callback.data ?? "";

  if (data === "five_play") {
    await ctx
      .answerCallbackQuery({ text: "Opening today's run" })
      .catch(() => undefined);
    await startDailyFive({
      chatId: msg.chat.id,
      userId,
      replyTo: msg.message_id,
    });
    return;
  }

  if (data === "league_show") {
    await ctx.answerCallbackQuery().catch(() => undefined);
    await sendLeague({
      chatId: msg.chat.id,
      userId,
      replyTo: msg.message_id,
    });
    return;
  }

  const duelNew = /^duel_new_(\d+)$/.exec(data);
  if (duelNew) {
    const attempt = await getAttempt(Number(duelNew[1]));
    if (
      !attempt ||
      attempt.userId !== userId ||
      attempt.game !== "five" ||
      attempt.status !== "done"
    ) {
      await ctx
        .answerCallbackQuery({
          text: "That run is gone. Play today's run.",
          show_alert: true,
        })
        .catch(() => undefined);
      return;
    }

    await ctx
      .answerCallbackQuery({ text: "Challenge ready" })
      .catch(() => undefined);
    await createDuelFromAttempt({
      attempt,
      chatId: msg.chat.id,
      replyTo: msg.message_id,
    });
    return;
  }

  const answer = /^q5_(\d+)_(\d+)_(\d+)$/.exec(data);
  if (!answer) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    return;
  }

  const attempt = await getAttempt(Number(answer[1]));
  if (!attempt || attempt.userId !== userId) {
    await ctx
      .answerCallbackQuery({
        text: "That's not your card.",
        show_alert: true,
      })
      .catch(() => undefined);
    return;
  }

  if (attempt.status === "done") {
    await ctx
      .answerCallbackQuery({ text: "This run is already finished." })
      .catch(() => undefined);
    if (attempt.game === "duel" && attempt.duelId) {
      const duel = await getDuel(attempt.duelId);
      if (duel) {
        await showDuelResult({
          duel,
          userId,
          chatId: msg.chat.id,
          messageId: msg.message_id,
        });
        return;
      }
    }
    await showFiveResult({
      attempt,
      chatId: msg.chat.id,
      messageId: msg.message_id,
      alreadyPlayed: true,
    });
    return;
  }

  const result = await recordAnswer({
    attempt,
    index: Number(answer[2]),
    option: Number(answer[3]),
  });

  if (result === "stale") {
    await ctx
      .answerCallbackQuery({
        text: "That question already moved on.",
        show_alert: true,
      })
      .catch(() => undefined);
    return;
  }

  await ctx
    .answerCallbackQuery({
      text: result.timedOut
        ? "Too slow"
        : result.correct
          ? `Correct +${result.earned}`
          : "Missed",
    })
    .catch(() => undefined);

  if (result.done) {
    if (result.attempt.game === "duel") {
      await finishDuelAttempt({
        attempt: result.attempt,
        chatId: msg.chat.id,
        messageId: msg.message_id,
      });
    } else {
      await finishFive({
        attempt: result.attempt,
        chatId: msg.chat.id,
        messageId: msg.message_id,
      });
    }
    return;
  }

  await showQuestion({
    chatId: msg.chat.id,
    attempt: result.attempt,
    messageId: msg.message_id,
  });
};
