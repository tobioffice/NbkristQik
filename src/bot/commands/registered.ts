import { bot } from "../bot.js";
import type { Message } from "node-telegram-bot-api";

import {
  sendAttendanceOrMidMarks,
  sendBunkPlan,
} from "../academics/studentActions.js";
import { sendPrivateCardLink } from "../academics/groupLink.js";
import {
  ephemeralCommand,
  sendEphemeral,
  type EphemeralTarget,
} from "../academics/ephemeral.js";
import { getRegistration } from "../../db/registration.model.js";
import {
  getStudentCached,
  StudentNotFoundError,
} from "../../services/redis/utils.js";
import { upsertTgUser } from "../../db/student.model.js";
import { CHIT_CHAT_ID } from "../../constants/index.js";
import { botSecurityHandler } from "../../middleware/security.js";
import { logger } from "../../config/logger.js";
import { trackMessage } from "../../services/tracker.js";
import { isAuthorizedUser } from "../authorization.js";
import { TOO_FAST, SOMETHING_BROKE } from "../replies.js";
import { appPageButton } from "./register.js";

/** A lookup the student can ask for by command. */
type Lookup = "att" | "mid" | "bunk";

const LOOKUP_TRACKED_AS: Record<Lookup, string> = {
  att: "command:attendance",
  mid: "command:midmarks",
  bunk: "command:bunk",
};

/**
 * A prompt with the registration button. It is ephemeral when the command
 * that caused it was, so a group never sees a card that only makes sense to
 * one student.
 */
const sendPrompt = async (
  chatId: number,
  isPrivate: boolean,
  ephemeral: EphemeralTarget | undefined,
  text: string,
  label: string,
): Promise<void> => {
  const markup = {
    inline_keyboard: [[appPageButton(label, "profile", isPrivate)]],
  };

  if (ephemeral) {
    await sendEphemeral(chatId, ephemeral, text, markup).catch((e: Error) =>
      logger.warn("[registered] prompt failed:", e?.message ?? e),
    );
    return;
  }

  await bot.api
    .sendMessage({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: markup,
    })
    .catch((e: Error) =>
      logger.warn("[registered] register prompt failed:", e?.message ?? e),
    );
};

/**
 * Resolve the caller's registered roll, or explain why not.
 * Returns the uppercase roll, or null after sending the right guidance.
 */
export const resolveRegisteredRoll = async (
  userId: number,
  chatId: number,
  isPrivate: boolean,
  ephemeral?: EphemeralTarget,
): Promise<string | null> => {
  const registration = await getRegistration(String(userId));
  if (!registration) {
    await sendPrompt(
      chatId,
      isPrivate,
      ephemeral,
      `Save your roll number first, then this command answers instantly.`,
      "👤 Register your roll",
    );
    return null;
  }

  try {
    // also refresh the tgusers mapping so the last-lookup suggestion stays consistent
    const student = await getStudentCached(registration.roll_no);
    void upsertTgUser(String(userId), student).catch(() => {});
    return registration.roll_no;
  } catch (e) {
    if (e instanceof StudentNotFoundError) {
      // registered roll left studentsnew (semester sync) — ask for an update
      await sendPrompt(
        chatId,
        isPrivate,
        ephemeral,
        `Your saved roll <code>${registration.roll_no}</code> isn't in the college records anymore.\n\n` +
          `If the semester changed, save your new roll and this command works again.`,
        "👤 Register your roll",
      );
      return null;
    }

    // Redis/DB hiccup, not a stale registration — don't tell the user their
    // roll was deleted.
    logger.warn("[registered] roll refresh failed:", e);
    const text = "Couldn't check your roll right now. Try again in a minute.";
    if (ephemeral) {
      await sendEphemeral(chatId, ephemeral, text).catch(() => {});
    } else {
      await bot.api.sendMessage({ chat_id: chatId, text }).catch(() => {});
    }
    return null;
  }
};

const handleLookup = async (msg: Message, lookup: Lookup): Promise<void> => {
  const { chat } = msg;
  const from = msg.from;
  if (!from) return;
  // channels are broadcast: instant commands serve nothing there
  if (chat.type === "channel") return;

  if (chat.id === CHIT_CHAT_ID) {
    bot.api
      .deleteMessage({ chat_id: chat.id, message_id: msg.message_id })
      .catch(() => {});
    return;
  }

  const ephemeral = ephemeralCommand(msg);

  if (!(await botSecurityHandler(from.id, "command"))) {
    if (ephemeral) {
      await sendEphemeral(chat.id, ephemeral, TOO_FAST).catch(() => {});
    } else {
      await bot.api.sendMessage({ chat_id: chat.id, text: TOO_FAST });
    }
    return;
  }

  const isPrivate = chat.type === "private";

  const authorized = await isAuthorizedUser({
    userId: from.id,
    chatId: chat.id,
  });
  if (!authorized) return;

  trackMessage(msg, LOOKUP_TRACKED_AS[lookup]);

  const rollNo = await resolveRegisteredRoll(
    from.id,
    chat.id,
    isPrivate,
    ephemeral ?? undefined,
  );
  if (!rollNo) return;

  // A group is a shared room. An ephemeral command answers the sender alone;
  // any other group command gets the private link and never the card.
  if (!isPrivate && !ephemeral) {
    await sendPrivateCardLink(msg, rollNo, lookup);
    return;
  }

  const options = ephemeral ? { ephemeral } : undefined;
  if (lookup === "bunk") {
    await sendBunkPlan(msg, rollNo, options);
  } else {
    await sendAttendanceOrMidMarks(msg, rollNo, lookup, options);
  }
};

const registered = (command: string, lookup: Lookup): void => {
  bot.command(command, (ctx) => {
    const msg = ctx.message;
    if (!msg) return;

    const ephemeral = ephemeralCommand(msg);
    return handleLookup(msg, lookup).catch(async (e) => {
      logger.error("[registered] lookup failed:", e);
      if (ephemeral) {
        await sendEphemeral(msg.chat.id, ephemeral, SOMETHING_BROKE).catch(
          () => {},
        );
        return;
      }
      await bot.api
        .sendMessage({ chat_id: msg.chat.id, text: SOMETHING_BROKE })
        .catch(() => {});
    });
  });
};

registered("attendance", "att");
registered("midmarks", "mid");
registered("bunk", "bunk");
