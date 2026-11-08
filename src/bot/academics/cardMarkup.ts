import { getRegistration } from "../../db/registration.model.js";
import { logger } from "../../config/logger.js";
import { WEBAPP_URL } from "../../constants/webapp.js";

/**
 * The keyboard that travels with every attendance card.
 *
 * A card is not a dead end: the student can switch to mid marks, ask for a
 * bunk plan, save the roll, or open the leaderboard without typing the roll
 * again. The same markup is rebuilt for each render so the Save button
 * disappears as soon as the roll belongs to the reader.
 */
export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
}

export interface CardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export const cardMarkup = ({
  roll,
  isPrivate,
  showSave,
}: {
  roll: string;
  isPrivate: boolean;
  showSave: boolean;
}): CardMarkup => {
  const secondRow: InlineKeyboardButton[] = [];
  if (showSave) {
    secondRow.push({ text: "Save this roll", callback_data: `save_${roll}` });
  }
  secondRow.push(
    // web_app buttons are private-only; groups get a plain link
    isPrivate
      ? { text: "Leaderboard", web_app: { url: WEBAPP_URL } }
      : { text: "Leaderboard", url: WEBAPP_URL },
  );

  return {
    inline_keyboard: [
      [
        { text: "Attendance", callback_data: `att_${roll}` },
        { text: "Mid marks", callback_data: `mid_${roll}` },
        { text: "Bunk", callback_data: `bunk_${roll}` },
      ],
      secondRow,
    ],
  };
};

/**
 * True when this reader has already saved this exact roll.
 *
 * A database hiccup must not hide the button: showing Save again is harmless
 * (the write is idempotent), while hiding it would strand the student who has
 * not saved yet.
 */
export const isRollSaved = async (
  userId: number,
  roll: string,
): Promise<boolean> => {
  try {
    const registration = await getRegistration(String(userId));
    return registration?.roll_no.toUpperCase() === roll.toUpperCase();
  } catch (e) {
    logger.debug(
      "[cardMarkup] registration read skipped:",
      e instanceof Error ? e.message : e,
    );
    return false;
  }
};
