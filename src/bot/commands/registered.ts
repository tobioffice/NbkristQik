import { bot } from "../bot.js";
import type { Message } from "node-telegram-bot-api";

import {
  sendAttendanceOrMidMarks,
  sendBunkPlan,
} from "../academics/studentActions.js";
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
import { REGISTER_WEBAPP_URL } from "../../constants/webapp.js";
import { appPageButton } from "./register.js";

/** A lookup the student can ask for by command. */
type Lookup = "att" | "mid" | "bunk";

const LOOKUP_TRACKED_AS: Record<Lookup, string> = {
  att: "command:attendance",
  mid: "command:midmarks",
  bunk: "command:bunk",
};

/**
 * Ask the student to save their roll. `isPrivate` keeps the button a
 * `web_app` in a DM and a plain link in a group, where Telegram rejects
 * `web_app` buttons.
 */
const promptRegister = (chatId: number, isPrivate: boolean): void => {
  bot
    .sendMessage(
      chatId,
      `Save your roll number first, then this command answers instantly.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              appPageButton(
                "👤 Register your roll",
                REGISTER_WEBAPP_URL,
                isPrivate,
              ),
            ],
          ],
        },
      },
    )
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
): Promise<string | null> => {
  const registration = await getRegistration(String(userId));
  if (!registration) {
    promptRegister(chatId, isPrivate);
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
      bot
        .sendMessage(
          chatId,
          `Your saved roll <code>${registration.roll_no}</code> isn't in the college records anymore.\n\n` +
            `If the semester changed, save your new roll and this command works again.`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  appPageButton(
                    "👤 Register your roll",
                    REGISTER_WEBAPP_URL,
                    isPrivate,
                  ),
                ],
              ],
            },
          },
        )
        .catch((sendError: Error) =>
          logger.warn(
            "[registered] stale-roll prompt failed:",
            sendError?.message ?? sendError,
          ),
        );
      return null;
    }

    // Redis/DB hiccup, not a stale registration — don't tell the user their
    // roll was deleted.
    logger.warn("[registered] roll refresh failed:", e);
    bot
      .sendMessage(
        chatId,
        "Couldn't check your roll right now. Try again in a minute.",
      )
      .catch(() => {});
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
    bot.deleteMessage(chat.id, msg.message_id).catch(() => {});
    return;
  }

  if (!(await botSecurityHandler(from.id, "command"))) {
    await bot.sendMessage(chat.id, TOO_FAST);
    return;
  }

  const isPrivate = chat.type === "private";

  const authorized = await isAuthorizedUser({
    userId: from.id,
    chatId: chat.id,
  });
  if (!authorized) return;

  trackMessage(msg, LOOKUP_TRACKED_AS[lookup]);

  const rollNo = await resolveRegisteredRoll(from.id, chat.id, isPrivate);
  if (!rollNo) return;

  if (lookup === "bunk") {
    await sendBunkPlan(msg, rollNo);
  } else {
    await sendAttendanceOrMidMarks(msg, rollNo, lookup);
  }
};

const registered = (lookup: Lookup) => (msg: Message) => {
  handleLookup(msg, lookup).catch((e) => {
    logger.error("[registered] lookup failed:", e);
    bot.sendMessage(msg.chat.id, SOMETHING_BROKE).catch(() => {});
  });
};

bot.onText(/\/attendance/, registered("att"));
bot.onText(/\/midmarks/, registered("mid"));
bot.onText(/\/bunk/, registered("bunk"));
