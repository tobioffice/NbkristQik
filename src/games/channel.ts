import { bot } from "../bot/bot.js";
import { TelegramApiError, type Message } from "node-telegram-bot-api";
import { ADMIN_ID, CHANNEL_ID } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import { trackMessage } from "../services/tracker.js";
import { commandArgs } from "../bot/commands/args.js";
import {
  claimGamePost,
  getDaySections,
  getTodayAttempts,
  getWeekPlayers,
  getWeekSections,
  releaseGamePost,
} from "../db/game.model.js";
import {
  fastestCorrect,
  dayLabel,
  morningPost,
  resultsPost,
  weekLabel,
  weeklyPost,
  type Card,
} from "./cards.js";
import { channelPostsEnabled, seasonKey } from "./config.js";
import { istStamp } from "./time.js";
import type { BoardPlayer, BoardSection } from "./types.js";

/**
 * The channel ritual.
 *
 * Two posts a day at most: the 8:30am prompt and the 1:15pm result. Sunday
 * adds the weekly board at 7pm. Each post is claimed in `game_posts` before
 * it is sent, so a restart cannot duplicate it; a failed send releases the
 * claim and the next tick retries inside the window.
 */

const MORNING_START = 8 * 60 + 30;
const MORNING_END = 10 * 60 + 30;
const RESULT_START = 13 * 60 + 15;
const RESULT_END = 16 * 60 + 15;
const WEEKLY_START = 19 * 60;
const WEEKLY_END = 21 * 60;

/**
 * Telegram refused the rich form itself. A 400 means nothing was posted, so a
 * text retry cannot put the same card in the channel twice. Any other failure
 * may already have delivered the message, so it must not be retried here.
 */
export const isRichRefusal = (error: unknown): boolean =>
  error instanceof TelegramApiError && error.errorCode === 400;

/**
 * Post one card, rich form first.
 *
 * The channel and the admin preview both use this path, so what the admin
 * checks with `/gamepost` is exactly what the channel receives.
 */
export const postCard = async (
  chatId: number | string,
  card: Card,
): Promise<void> => {
  if (card.rich) {
    try {
      await bot.api.sendRichMessage({
        chat_id: chatId,
        rich_message: { html: card.rich },
        ...(card.markup ? { reply_markup: card.markup } : {}),
      });
      return;
    } catch (e) {
      if (!isRichRefusal(e)) throw e;
      logger.warn(
        "[games] rich card refused, posting the text card:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  await bot.api.sendMessage({
    chat_id: chatId,
    text: card.text,
    parse_mode: "HTML",
    ...(card.markup ? { reply_markup: card.markup } : {}),
    link_preview_options: { is_disabled: true },
  });
};

const sendCard = async (card: Card): Promise<void> => {
  await postCard(CHANNEL_ID, card);
};

const postMorning = async (dateKey: string): Promise<void> => {
  const key = `morning-${dateKey}`;
  if (!(await claimGamePost(key))) return;
  try {
    await sendCard(morningPost(dayLabel(dateKey)));
    logger.info(`[games] morning post sent for ${dateKey}`);
  } catch (e) {
    await releaseGamePost(key).catch(() => undefined);
    logger.warn("[games] morning post failed:", e);
  }
};

const postResults = async (dateKey: string): Promise<void> => {
  const attempts = await getTodayAttempts(dateKey);
  if (attempts.length === 0) return;

  const key = `results-${dateKey}`;
  if (!(await claimGamePost(key))) return;

  try {
    const top: BoardPlayer[] = attempts.slice(0, 3).map((attempt) => ({
      userId: attempt.userId,
      rollNo: attempt.rollNo,
      displayName: attempt.displayName,
      points: attempt.points,
    }));
    const sections = await getDaySections(seasonKey(), dateKey, 1);

    await sendCard(
      resultsPost({
        label: dayLabel(dateKey),
        top,
        played: attempts.length,
        fastestMs: fastestCorrect(attempts.map((attempt) => attempt.answers)),
        section: sections[0] ?? null,
      }),
    );
    logger.info(
      `[games] results post sent for ${dateKey} (${attempts.length} runs)`,
    );
  } catch (e) {
    await releaseGamePost(key).catch(() => undefined);
    logger.warn("[games] results post failed:", e);
  }
};

const postWeekly = async (
  weekKey: string,
  mondayKey: string,
): Promise<void> => {
  const [sections, players] = await Promise.all([
    getWeekSections(seasonKey(), weekKey, 3),
    getWeekPlayers(seasonKey(), weekKey, 1),
  ]);
  if (sections.length === 0) return;

  const key = `weekly-${weekKey}`;
  if (!(await claimGamePost(key))) return;

  try {
    await sendCard(
      weeklyPost({
        label: weekLabel(mondayKey),
        sections,
        players,
      }),
    );
    logger.info(`[games] weekly post sent for ${weekKey}`);
  } catch (e) {
    await releaseGamePost(key).catch(() => undefined);
    logger.warn("[games] weekly post failed:", e);
  }
};

const tick = async (): Promise<void> => {
  if (!CHANNEL_ID || !channelPostsEnabled()) return;

  const stamp = istStamp();
  const minutes = stamp.hour * 60 + stamp.minute;

  if (minutes >= MORNING_START && minutes < MORNING_END) {
    await postMorning(stamp.date);
  }
  if (minutes >= RESULT_START && minutes < RESULT_END) {
    await postResults(stamp.date);
  }
  if (stamp.weekday === 7 && minutes >= WEEKLY_START && minutes < WEEKLY_END) {
    await postWeekly(stamp.week, stamp.monday);
  }
};

/** Start the once-a-minute check. Safe to call once per process. */
export const startGameScheduler = (): void => {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void tick()
      .catch((e) => logger.warn("[games] scheduler tick failed:", e))
      .finally(() => {
        running = false;
      });
  }, 60_000);
  timer.unref();
  logger.info(
    `[games] scheduler started (channel posts ${
      channelPostsEnabled() ? "on" : "off"
    })`,
  );
};

/* ------------------------------------------------------------------ */
/* Admin preview: the exact cards, sent to the admin's private chat.    */
/* ------------------------------------------------------------------ */

const SAMPLE_SECTIONS: BoardSection[] = [
  { key: "4|CSE|C", label: "4 CSE C", points: 4820, players: 9 },
  { key: "3|ECE|A", label: "3 ECE A", points: 4610, players: 8 },
  { key: "4|CSE|A", label: "4 CSE A", points: 4390, players: 10 },
];

const SAMPLE_PLAYERS: BoardPlayer[] = [
  {
    userId: 1,
    rollNo: "23KB1A0599",
    displayName: "Qik player",
    points: 2100,
  },
  { userId: 2, rollNo: "23KB1A0601", displayName: null, points: 1860 },
  { userId: 3, rollNo: "23KB1A0602", displayName: null, points: 1740 },
];

bot.command("gamepost", async (ctx) => {
  const msg: Message | undefined = ctx.message;
  if (!msg || msg.from?.id !== ADMIN_ID) return;

  trackMessage(msg, "command:gamepost");
  const stamp = istStamp();
  const args = commandArgs(ctx).toLowerCase();

  if (args === "channel") {
    if (!CHANNEL_ID) {
      await bot.api.sendMessage({
        chat_id: msg.chat.id,
        text: "Channel isn't set up.",
      });
      return;
    }
    try {
      await sendCard(morningPost(dayLabel(stamp.date)));
      await bot.api.sendMessage({
        chat_id: msg.chat.id,
        text: "Posted today's run to the channel.",
      });
    } catch (e) {
      logger.warn("[games] channel launch post failed:", e);
      await bot.api
        .sendMessage({
          chat_id: msg.chat.id,
          text: "That didn't send. Check the bot's admin rights in the channel.",
        })
        .catch(() => undefined);
    }
    return;
  }

  try {
    await bot.api.sendMessage({
      chat_id: msg.chat.id,
      text: "<i>Morning post</i>",
      parse_mode: "HTML",
    });
    await postCard(msg.chat.id, morningPost(dayLabel(stamp.date)));

    await bot.api.sendMessage({
      chat_id: msg.chat.id,
      text: "<i>Lunchtime result</i>",
      parse_mode: "HTML",
    });
    await postCard(
      msg.chat.id,
      resultsPost({
        label: dayLabel(stamp.date),
        top: SAMPLE_PLAYERS,
        played: 128,
        fastestMs: 4200,
        section: SAMPLE_SECTIONS[0],
      }),
    );

    await bot.api.sendMessage({
      chat_id: msg.chat.id,
      text: "<i>Sunday board</i>",
      parse_mode: "HTML",
    });
    await postCard(
      msg.chat.id,
      weeklyPost({
        label: weekLabel(stamp.monday),
        sections: SAMPLE_SECTIONS,
        players: SAMPLE_PLAYERS.slice(0, 1),
      }),
    );
  } catch (e) {
    logger.warn("[games] preview failed:", e);
    await bot.api
      .sendMessage({
        chat_id: msg.chat.id,
        text: "Couldn't build the preview.",
      })
      .catch(() => undefined);
  }
});
