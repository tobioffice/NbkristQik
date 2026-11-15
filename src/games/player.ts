import { bot } from "../bot/bot.js";
import { getRegistration } from "../db/registration.model.js";
import { getGamePlayer, upsertGamePlayer } from "../db/game.model.js";
import { getStudentCached } from "../services/redis/utils.js";
import { appPageUrl } from "../constants/webapp.js";
import { logger } from "../config/logger.js";
import type { SectionRef } from "./types.js";
import { sectionRefOf } from "./scoring.js";

export interface PlayerIdentity {
  userId: number;
  rollNo: string;
  displayName: string | null;
  sectionKey: string | null;
  sectionLabel: string | null;
}

/**
 * Resolve the account's saved roll into a league identity.
 *
 * A missing registration is the only hard stop: the league needs a roll to
 * put points on. A failed college-record lookup is not a stop, because the
 * section is only needed for the team board; the run still counts for the
 * individual one, and a previous section is kept when the roll has not
 * changed.
 */
export const loadPlayer = async (
  userId: number,
): Promise<PlayerIdentity | null> => {
  const registration = await getRegistration(String(userId));
  if (!registration) return null;

  const rollNo = registration.roll_no.toUpperCase();
  const existing = await getGamePlayer(userId);
  const sameRoll = existing?.rollNo.toUpperCase() === rollNo;

  let section: SectionRef | null = null;
  try {
    const student = await getStudentCached(rollNo);
    section = sectionRefOf(student);
  } catch (e) {
    logger.debug(
      "[games] section lookup skipped:",
      e instanceof Error ? e.message : e,
    );
  }

  const sectionKey =
    section?.key ?? (sameRoll ? (existing?.sectionKey ?? null) : null);
  const sectionLabel =
    section?.label ?? (sameRoll ? (existing?.sectionLabel ?? null) : null);
  const displayName =
    registration.display_name ??
    (sameRoll ? (existing?.displayName ?? null) : null);

  const identity: PlayerIdentity = {
    userId,
    rollNo,
    displayName,
    sectionKey,
    sectionLabel,
  };
  await upsertGamePlayer(identity);
  return identity;
};

/** The "save your roll first" card. */
export const sendRegistrationPrompt = async ({
  chatId,
  replyTo,
}: {
  chatId: number;
  replyTo?: number;
}): Promise<void> => {
  await bot.api.sendMessage({
    chat_id: chatId,
    text: "Save your roll first, then play. The league needs a section to put your points in.",
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open registration",
            web_app: { url: appPageUrl("profile", "web_app") },
          },
        ],
      ],
    },
    ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {}),
  });
};
