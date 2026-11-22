import { bot } from "../bot/bot.js";
import { TelegramApiError, type Message } from "node-telegram-bot-api";
import { ADMIN_ID, CHANNEL_ID } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import { trackMessage } from "../services/tracker.js";
import { commandArgs } from "../bot/commands/args.js";
import {
  clearChannelBoard,
  getChannelBoard,
  getWeekPlayers,
  getWeekSections,
  saveChannelBoard,
} from "../db/game.model.js";
import {
  LIVE_BOARD_ROWS,
  liveBoardCard,
  weekLabel,
  type Card,
} from "./cards.js";
import { channelPostsEnabled, seasonKey } from "./config.js";
import { withBoardIdentities } from "./identity.js";
import { boardName } from "./scoring.js";
import { istClockLabel, istStamp } from "./time.js";
import type { BoardPlayer, BoardSection } from "./types.js";

/**
 * The channel's single live board.
 *
 * One message, edited in place: this week's student and section tables. The
 * minute tick recomputes the rows and edits only when the data fingerprint
 * changed, so a quiet week leaves the channel quiet. The message id and the
 * last fingerprint live in `game_channel_board`, so a restart edits the same
 * message instead of posting a second one.
 */

const BOARD_SLOT = "live";
/** Bumped when the card's markup changes, so a deploy refreshes the message. */
const BOARD_FORMAT = 2;

export interface LiveBoard {
  label: string;
  players: BoardPlayer[];
  sections: BoardSection[];
}

/** This week's rows, already ordered by the database. */
export const readLiveBoard = async (): Promise<LiveBoard> => {
  const stamp = istStamp();
  const season = seasonKey();
  const [players, sections] = await Promise.all([
    getWeekPlayers(season, stamp.week, LIVE_BOARD_ROWS),
    getWeekSections(season, stamp.week, LIVE_BOARD_ROWS),
  ]);

  // Verified owners are named by their roll; everyone else by their chosen
  // name or Telegram profile, so the card needs those identities.
  return {
    label: weekLabel(stamp.monday),
    players: await withBoardIdentities(players),
    sections,
  };
};

/**
 * The fingerprint of what the card shows. The updated clock is not part of
 * it: a minute that changes no number must not edit the message.
 */
export const liveBoardSnapshot = (board: LiveBoard): string =>
  JSON.stringify({
    version: BOARD_FORMAT,
    label: board.label,
    players: board.players.map((player) => [boardName(player), player.points]),
    sections: board.sections.map((section) => [section.label, section.points]),
  });

const isApiError = (error: unknown, code: number): error is TelegramApiError =>
  error instanceof TelegramApiError && error.errorCode === code;

/** Telegram refused the rich form itself, so nothing was delivered. */
export const isRichRefusal = (error: unknown): boolean =>
  isApiError(error, 400);

const isNotModified = (error: unknown): boolean =>
  isApiError(error, 400) && /message is not modified/i.test(error.description);

const isMessageGone = (error: unknown): boolean =>
  isApiError(error, 400) &&
  /message to edit not found|message to delete not found|message can't be edited|message_id_invalid/i.test(
    error.description,
  );

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Post one card, rich form first, and return the message id.
 *
 * A 400 means the rich form was refused before delivery, so the text retry
 * cannot duplicate anything. Any other failure may already have posted, so it
 * is rethrown and the next tick decides again.
 */
export const postCard = async (
  chatId: number | string,
  card: Card,
): Promise<number> => {
  if (card.rich) {
    try {
      const sent = await bot.api.sendRichMessage({
        chat_id: chatId,
        rich_message: { html: card.rich },
        ...(card.markup ? { reply_markup: card.markup } : {}),
      });
      return sent.message_id;
    } catch (e) {
      if (!isRichRefusal(e)) throw e;
      logger.warn(
        "[games] rich card refused, posting the text card:",
        errorText(e),
      );
    }
  }

  const sent = await bot.api.sendMessage({
    chat_id: chatId,
    text: card.text,
    parse_mode: "HTML",
    ...(card.markup ? { reply_markup: card.markup } : {}),
    link_preview_options: { is_disabled: true },
  });
  return sent.message_id;
};

/** Edit the live message: rich first, the text card when rich is refused. */
const editCard = async (
  chatId: number | string,
  messageId: number,
  card: Card,
): Promise<void> => {
  const markup = card.markup ? { reply_markup: card.markup } : {};

  if (card.rich) {
    try {
      await bot.api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        rich_message: { html: card.rich },
        ...markup,
      });
      return;
    } catch (e) {
      if (isNotModified(e) || isMessageGone(e) || !isApiError(e, 400)) throw e;
      logger.warn(
        "[games] rich board edit refused, editing the text card:",
        errorText(e),
      );
    }
  }

  await bot.api.editMessageText({
    chat_id: chatId,
    message_id: messageId,
    text: card.text,
    parse_mode: "HTML",
    ...markup,
  });
};

const boardCard = (board: LiveBoard, updatedAt: string): Card =>
  liveBoardCard({ ...board, updatedAt });

const saveState = async ({
  messageId,
  snapshot,
  updatedAt,
}: {
  messageId: number;
  snapshot: string;
  updatedAt: string;
}): Promise<void> => {
  await saveChannelBoard({
    slot: BOARD_SLOT,
    chatId: String(CHANNEL_ID),
    messageId,
    snapshot,
    updatedAt,
  });
};

const postBoard = async (
  board: LiveBoard,
  snapshot: string,
  now: Date,
): Promise<"created"> => {
  const messageId = await postCard(
    CHANNEL_ID,
    boardCard(board, istClockLabel(now)),
  );
  await saveState({ messageId, snapshot, updatedAt: now.toISOString() });
  logger.info(`[games] live board posted for ${board.label}`);
  return "created";
};

export type BoardSync = "created" | "edited" | "unchanged";

/**
 * Bring the channel's single message up to date.
 *
 * Returns what happened so the tick and the admin command can report it. An
 * unchanged fingerprint is the common case and does no Telegram call at all.
 */
export const syncLiveBoard = async (): Promise<BoardSync> => {
  const [board, state] = await Promise.all([
    readLiveBoard(),
    getChannelBoard(BOARD_SLOT),
  ]);
  const snapshot = liveBoardSnapshot(board);

  // No message yet, or the configured channel changed: post the first one.
  if (!state || state.chatId !== String(CHANNEL_ID)) {
    return postBoard(board, snapshot, new Date());
  }

  if (state.snapshot === snapshot) return "unchanged";

  const now = new Date();
  try {
    await editCard(
      CHANNEL_ID,
      state.messageId,
      boardCard(board, istClockLabel(now)),
    );
  } catch (e) {
    if (isMessageGone(e)) {
      logger.warn("[games] live board message is gone, posting a new one");
      return postBoard(board, snapshot, new Date());
    }
    if (isNotModified(e)) {
      // The data moved but renders the same. Remember the fingerprint so the
      // next tick does not try this edit again.
      await saveState({
        messageId: state.messageId,
        snapshot,
        updatedAt: state.updatedAt,
      });
      return "unchanged";
    }
    throw e;
  }

  await saveState({
    messageId: state.messageId,
    snapshot,
    updatedAt: now.toISOString(),
  });
  logger.info(`[games] live board edited for ${board.label}`);
  return "edited";
};

/**
 * Delete the stored board message and post a fresh one.
 *
 * The new message sits at the bottom of the channel, which is what makes the
 * board the most recent post. A message that is already gone is not an error;
 * any other delete failure stops the repost, so the channel never ends up
 * with the old board and a duplicate side by side.
 */
export const repostLiveBoard = async (): Promise<BoardSync> => {
  const state = await getChannelBoard(BOARD_SLOT);

  if (state) {
    try {
      await bot.api.deleteMessage({
        chat_id: state.chatId,
        message_id: state.messageId,
      });
    } catch (e) {
      if (!isMessageGone(e)) throw e;
    }
    await clearChannelBoard(BOARD_SLOT);
  }

  const result = await syncLiveBoard();
  logger.info(`[games] live board reposted (${result})`);
  return result;
};

const tick = async (): Promise<void> => {
  if (!CHANNEL_ID || !channelPostsEnabled()) return;
  await syncLiveBoard();
};

/** Start the once-a-minute sync. Safe to call once per process. */
export const startGameScheduler = (): void => {
  let running = false;
  const run = (): void => {
    if (running) return;
    running = true;
    void tick()
      .catch((e) => logger.warn("[games] live board tick failed:", e))
      .finally(() => {
        running = false;
      });
  };

  // Sync now, so a deploy does not leave the board stale for a minute.
  run();
  const timer = setInterval(run, 60_000);
  timer.unref();
  logger.info(
    `[games] live board syncing every minute (channel posts ${
      channelPostsEnabled() ? "on" : "off"
    })`,
  );
};

/* ------------------------------------------------------------------ */
/* Admin preview and a manual refresh.                                 */
/* ------------------------------------------------------------------ */

bot.command("gamepost", async (ctx) => {
  const msg: Message | undefined = ctx.message;
  if (!msg || msg.from?.id !== ADMIN_ID) return;

  trackMessage(msg, "command:gamepost");
  const args = commandArgs(ctx).toLowerCase();

  if (args === "repost") {
    if (!CHANNEL_ID) {
      await bot.api.sendMessage({
        chat_id: msg.chat.id,
        text: "Channel isn't set up.",
      });
      return;
    }

    try {
      await repostLiveBoard();
      await bot.api.sendMessage({
        chat_id: msg.chat.id,
        text: "Old board deleted. A fresh one is now the latest message in the channel.",
      });
    } catch (e) {
      logger.warn("[games] live board repost failed:", e);
      await bot.api
        .sendMessage({
          chat_id: msg.chat.id,
          text: "Couldn't delete the old board. Check the bot's delete permission in the channel.",
        })
        .catch(() => undefined);
    }
    return;
  }

  if (args === "channel") {
    if (!CHANNEL_ID) {
      await bot.api.sendMessage({
        chat_id: msg.chat.id,
        text: "Channel isn't set up.",
      });
      return;
    }

    try {
      const result = await syncLiveBoard();
      const text =
        result === "created"
          ? "Live board posted to the channel."
          : result === "edited"
            ? "Live board refreshed."
            : "Live board is already up to date.";
      await bot.api.sendMessage({ chat_id: msg.chat.id, text });
    } catch (e) {
      logger.warn("[games] live board refresh failed:", e);
      await bot.api
        .sendMessage({
          chat_id: msg.chat.id,
          text: "That didn't send. Check the bot's admin rights in the channel.",
        })
        .catch(() => undefined);
    }
    return;
  }

  // Preview the real board, so the admin sees exactly what the channel holds.
  try {
    const board = await readLiveBoard();
    await postCard(msg.chat.id, boardCard(board, istClockLabel()));
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
