import type { Message } from "node-telegram-bot-api";
import { bot } from "./bot.js";
import { ADMIN_ID, MODERATION_CHAT_IDS } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import { escapeHtml } from "../services/text.js";
import {
  getModeratedUser,
  logChatMessage,
  removeChatMessage,
} from "../db/chatModeration.model.js";
import {
  autoModerate,
  banUser,
  deleteUserMessages,
  kickUser,
  ModerationError,
  muteUser,
  targetLabel,
  unbanUser,
  unmuteUser,
  type BaseAction,
} from "../services/moderation/actions.js";
import {
  formatDuration,
  parseModerationCommand,
  type ModerationCommand,
} from "../services/moderation/commands.js";
import { matchBlockedWords } from "../services/moderation/keywords.js";
import { getModerationSettings } from "../services/moderation/settings.js";
import {
  botUserId,
  deleteMessageQuietly,
  isChatAdmin,
  telegramErrorText,
} from "../services/moderation/telegram.js";

/**
 * The chat regulation layer's place in the bot.
 *
 * Registered before every other handler and always handing the update on, so
 * it sees all messages without taking commands away from the modules that
 * own them. Two jobs:
 *  - the group admin replies to a member's message with /ban, /mute, /kick,
 *    /purge, /unban or /unmute;
 *  - a message carrying a blocked word is removed and its sender muted.
 *
 * The layer is inert in every chat except MODERATION_CHAT_IDS (the chit-chat
 * group by default), and in those it stays quiet unless the admin set it up:
 * promote the bot to admin with delete and restrict rights, or Telegram will
 * refuse the restriction and the panel will say so.
 */

const CONFIRMATION_TTL_MS = 25_000;
const NOTICE_TTL_MS = 15_000;

const isRegulatedChat = (chatId: number): boolean =>
  MODERATION_CHAT_IDS.includes(chatId);

/** The text a message carries, whether it is a message or a caption. */
const textOf = (message: Message): string =>
  message.text ?? message.caption ?? "";

/** True when the message is something a purge should try to delete. */
const hasUserContent = (message: Message): boolean =>
  Boolean(
    message.text ||
    message.caption ||
    message.photo ||
    message.video ||
    message.animation ||
    message.document ||
    message.audio ||
    message.voice ||
    message.video_note ||
    message.sticker ||
    message.poll ||
    message.location ||
    message.venue ||
    message.contact ||
    message.dice,
  );

/** The target's display label, escaped for an HTML reply. */
const labelOf = (user: {
  first_name?: string;
  username?: string;
  id: number;
}): string =>
  escapeHtml(
    targetLabel({
      id: user.id,
      firstName: user.first_name,
      username: user.username,
    }),
  );

/** A line that removes itself, keeping the room clean after an action. */
const sendAndSweep = async (
  chatId: number,
  text: string,
  replyTo?: number,
): Promise<void> => {
  try {
    const sent = await bot.api.sendMessage({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_notification: true,
      ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {}),
    });
    setTimeout(() => {
      void deleteMessageQuietly(chatId, sent.message_id);
    }, CONFIRMATION_TTL_MS);
  } catch (e) {
    logger.debug("[moderation] confirmation failed:", telegramErrorText(e));
  }
};

/** " 3 messages removed." or nothing when the history was already clear. */
const removedNote = (count: number): string =>
  count > 0 ? ` ${count} message${count === 1 ? "" : "s"} removed.` : "";

/** The /ban, /mute, /kick, /purge, /unban and /unmute handlers. */
const runReplyCommand = async (
  message: Message,
  command: ModerationCommand,
): Promise<void> => {
  const chatId = message.chat.id;
  const actor = message.from;
  if (!actor) return;

  const replied = message.reply_to_message;
  const target = replied?.from;
  if (!target) {
    await sendAndSweep(
      chatId,
      "Reply to the message of the person you mean, then send the command.",
      message.message_id,
    );
    return;
  }
  if (target.id === (await botUserId())) {
    await sendAndSweep(
      chatId,
      "That one's me. I'll keep moderating.",
      message.message_id,
    );
    return;
  }
  if (target.id === actor.id) {
    await sendAndSweep(chatId, "That's your own message.", message.message_id);
    return;
  }

  const label = labelOf(target);
  const base: BaseAction = {
    chatId,
    target: {
      id: target.id,
      firstName: target.first_name ?? null,
      username: target.username ?? null,
    },
    actor: "admin",
    reason: command.reason,
  };

  try {
    switch (command.name) {
      case "ban": {
        const result = await banUser(base);
        await sendAndSweep(
          chatId,
          `Banned ${label}.${removedNote(result.deleted)}`,
          message.message_id,
        );
        return;
      }
      case "mute": {
        const settings = await getModerationSettings();
        const seconds = command.seconds ?? settings.muteSeconds;
        const result = await muteUser({ ...base, seconds });
        await sendAndSweep(
          chatId,
          `Muted ${label} for ${formatDuration(seconds)}.${removedNote(result.deleted)}`,
          message.message_id,
        );
        return;
      }
      case "kick": {
        const result = await kickUser(base);
        await sendAndSweep(
          chatId,
          `Removed ${label} from the group.${removedNote(result.deleted)}`,
          message.message_id,
        );
        return;
      }
      case "purge": {
        const result = await deleteUserMessages({
          ...base,
          extraIds: replied ? [replied.message_id] : [],
        });
        await sendAndSweep(
          chatId,
          result.deleted > 0
            ? `Removed ${result.deleted} message${
                result.deleted === 1 ? "" : "s"
              } from ${label}.`
            : `Nothing left to remove from ${label}.`,
          message.message_id,
        );
        return;
      }
      case "unban": {
        await unbanUser(base);
        await sendAndSweep(chatId, `Unbanned ${label}.`, message.message_id);
        return;
      }
      case "unmute": {
        await unmuteUser(base);
        await sendAndSweep(chatId, `Unmuted ${label}.`, message.message_id);
        return;
      }
    }
  } catch (e) {
    if (e instanceof ModerationError) {
      await sendAndSweep(chatId, escapeHtml(e.message), message.message_id);
      return;
    }
    logger.error("[moderation] reply command failed:", telegramErrorText(e));
    await sendAndSweep(
      chatId,
      "That didn't work. Try again in a bit.",
      message.message_id,
    );
  }
};

/** Whether this member can moderate the group; the bot's owner always can. */
const mayModerate = async (
  chatId: number,
  userId: number,
): Promise<boolean> => {
  if (userId === ADMIN_ID) return true;
  return (await isChatAdmin(chatId, userId)) === true;
};

/** The muted student's own explanation, when a DM can reach them. */
const notifyMuted = async (
  message: Message,
  seconds: number,
): Promise<void> => {
  const from = message.from;
  if (!from) return;
  try {
    await bot.api.sendMessage({
      chat_id: from.id,
      text: `I muted you in the group for ${formatDuration(
        seconds,
      )}. That message isn't allowed there. Read the group rules and carry on.`,
    });
  } catch (e) {
    // the student may never have started a chat with the bot; that is fine
    logger.debug("[moderation] mute DM skipped:", telegramErrorText(e));
  }
};

/**
 * Checks one message for blocked words and applies the policy. Never throws:
 * a broken moderation step must not stop the bot's other handlers.
 */
const enforceMessage = async (message: Message): Promise<void> => {
  const chatId = message.chat.id;
  const from = message.from;
  const text = textOf(message);
  if (!from || from.is_bot || !text) return;
  if (from.id === ADMIN_ID) return;

  let settings;
  try {
    settings = await getModerationSettings();
  } catch (e) {
    logger.warn("[moderation] settings read failed:", telegramErrorText(e));
    return;
  }
  if (!settings.enabled) return;
  if (!settings.autoDelete && !settings.autoMute) return;

  let matches: string[];
  try {
    matches = await matchBlockedWords(text);
  } catch (e) {
    logger.warn("[moderation] keyword read failed:", telegramErrorText(e));
    return;
  }
  if (matches.length === 0) return;

  // A group admin may quote the word while enforcing it; a failed lookup
  // (null) fails open rather than muting the wrong student on a bad minute.
  if ((await isChatAdmin(chatId, from.id)) !== false) return;

  // Someone already restricted (a race with the mute) only needs the message
  // gone; repeating the audit line would drown the panel.
  const existing = await getModeratedUser(chatId, from.id).catch(() => null);
  if (existing) {
    if (await deleteMessageQuietly(chatId, message.message_id)) {
      await removeChatMessage(chatId, message.message_id).catch(
        () => undefined,
      );
    }
    return;
  }

  try {
    const result = await autoModerate({
      chatId,
      target: {
        id: from.id,
        firstName: from.first_name ?? null,
        username: from.username ?? null,
      },
      messageId: message.message_id,
      matched: matches,
      settings,
    });
    if (result.deleted) {
      await removeChatMessage(chatId, message.message_id).catch(
        () => undefined,
      );
      if (settings.noticeInChat) {
        await bot.api
          .sendMessage({
            chat_id: chatId,
            text: "Removed that message. Not allowed here.",
            disable_notification: true,
          })
          .then((notice) => {
            setTimeout(() => {
              void deleteMessageQuietly(chatId, notice.message_id);
            }, NOTICE_TTL_MS);
          })
          .catch(() => undefined);
      }
    }
    if (result.muteError) {
      logger.warn(`[moderation] auto mute failed: ${result.muteError}`);
    }
    if (result.muted && settings.notifyUser) {
      await notifyMuted(message, settings.muteSeconds);
    }
  } catch (e) {
    logger.error("[moderation] auto moderation failed:", telegramErrorText(e));
  }
};

/**
 * The message update. Returns true when the layer consumed the update (an
 * admin reply command), false when the normal handlers should still see it.
 */
const handleMessage = async (message: Message): Promise<boolean> => {
  const chatId = message.chat.id;
  if (!isRegulatedChat(chatId)) return false;

  const from = message.from;
  if (!from || from.is_bot) return false;

  const command = parseModerationCommand(textOf(message));
  if (command) {
    if (await mayModerate(chatId, from.id)) {
      await runReplyCommand(message, command);
    }
    // A student typing /ban gets no reply; the room already has admins.
    return true;
  }

  // Remember the id before anything can act on the message, so /purge can
  // clear this user's history later.
  if (hasUserContent(message)) {
    void logChatMessage(chatId, from.id, message.message_id).catch((e) =>
      logger.debug("[moderation] message log skipped:", telegramErrorText(e)),
    );
  }

  await enforceMessage(message);
  return false;
};

/** An edit can turn a clean message into a blocked one; treat it the same. */
const handleEditedMessage = async (message: Message): Promise<void> => {
  if (!isRegulatedChat(message.chat.id)) return;
  await enforceMessage(message);
};

// Cooperative middleware: the layer looks at every message and then hands it
// on, so commands and lookups keep their own handlers whatever the import
// order. Consuming only our own reply commands keeps /report, /attendance and
// the roll flow working in the group.
bot.on("message", async (ctx, next) => {
  try {
    const consumed = ctx.message ? await handleMessage(ctx.message) : false;
    if (consumed) return;
  } catch (e) {
    logger.error("[moderation] message handler failed:", telegramErrorText(e));
  }
  await next();
});

bot.on("edited_message", async (ctx, next) => {
  try {
    if (ctx.editedMessage) await handleEditedMessage(ctx.editedMessage);
  } catch (e) {
    logger.error(
      "[moderation] edited message handler failed:",
      telegramErrorText(e),
    );
  }
  await next();
});
