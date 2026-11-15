import type { InlineQueryResultArticle } from "node-telegram-bot-api";
import { bot } from "../bot/bot.js";
import { getRegistration } from "../db/registration.model.js";
import { getStudentRank } from "../db/student_stats.model.js";
import { appDirectLink } from "../constants/webapp.js";
import { escapeHtml } from "./text.js";

export type RankSort = "attendance" | "midmarks";

export interface RankShareInput {
  roll: string;
  sort: RankSort;
  rank: number;
  total: number;
  value: number | null;
}

export interface PreparedRankShare {
  id: string;
  expiresAt: number;
}

const labelOf = (sort: RankSort): string =>
  sort === "attendance" ? "Attendance rank" : "Mid-mark rank";

const scoreOf = (value: number | null, sort: RankSort): string | null => {
  if (value == null) return null;
  return sort === "attendance" ? `${value.toFixed(2)}%` : `${value.toFixed(1)}`;
};

/**
 * The card a student can share to any chat.
 *
 * It carries the roll and the rank, never a name: the student chose to share
 * the figure, not their classmate's identity. The button opens the register
 * as a Mini App direct link, so a recipient who never used the bot can still
 * see where the figure came from.
 */
export const buildRankShare = ({
  roll,
  sort,
  rank,
  total,
  value,
}: RankShareInput): InlineQueryResultArticle => {
  const label = labelOf(sort);
  const score = scoreOf(value, sort);
  const summary = `#${rank} of ${total}${score ? ` · ${score}` : ""}`;

  return {
    type: "article",
    id: `rank-${sort}-${roll}`,
    title: `My ${label.toLowerCase()}`,
    description: summary,
    input_message_content: {
      message_text:
        `🏆 <b>${label}</b>\n` +
        `<code>${escapeHtml(roll)}</code>\n` +
        `<b>#${rank}</b> of ${total}${score ? ` · ${score}` : ""}\n\n` +
        `<i>Open the register to see where you stand.</i>`,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    },
    reply_markup: {
      inline_keyboard: [
        [{ text: "Open the register", url: appDirectLink("rank") }],
      ],
    },
  };
};

export type PrepareRankShareResult =
  | { ok: true; share: PreparedRankShare }
  | { ok: false; status: number; error: string };

/**
 * Build and store a prepared message for this student.
 *
 * Telegram keeps the prepared id for a short while; the Mini App hands it to
 * `shareMessage` right away, so the expiry is informational.
 */
export const prepareRankShare = async (
  userId: number,
  sort: RankSort,
): Promise<PrepareRankShareResult> => {
  const registration = await getRegistration(String(userId));
  if (!registration) {
    return {
      ok: false,
      status: 400,
      error: "Save your roll number first, then you can share your rank.",
    };
  }

  const rank = await getStudentRank(registration.roll_no, sort);
  if (!rank) {
    return {
      ok: false,
      status: 404,
      error: "No rank yet. Check your figure once, then try again.",
    };
  }

  const result = buildRankShare({
    roll: registration.roll_no,
    sort,
    ...rank,
  });

  const prepared = await bot.api.savePreparedInlineMessage({
    user_id: userId,
    result,
    allow_user_chats: true,
    allow_group_chats: true,
    allow_channel_chats: true,
  });

  return {
    ok: true,
    share: { id: prepared.id, expiresAt: prepared.expiration_date },
  };
};
