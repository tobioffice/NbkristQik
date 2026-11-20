import type {
  InlineQueryResultArticle,
  InlineQueryResultPhoto,
} from "node-telegram-bot-api";
import { bot } from "../bot/bot.js";
import { getRegistration } from "../db/registration.model.js";
import {
  getStudentRank,
  yearDigit,
  type LeaderboardFilters,
} from "../db/student_stats.model.js";
import { getStudentCached } from "./redis/utils.js";
import { appDirectLink } from "../constants/webapp.js";
import { BRANCHES } from "../constants/index.js";
import { escapeHtml } from "./text.js";
import { logger } from "../config/logger.js";

export type RankSort = "attendance" | "midmarks";

/** The board the figure belongs to: the caller's section, or everyone. */
export type RankScope = "section" | "all";

export interface RankShareInput {
  roll: string;
  sort: RankSort;
  rank: number;
  total: number;
  value: number | null;
  scope?: RankScope;
  /** `CSE · Year 3 · Section A` for a section; ignored for `all`. */
  scopeLabel?: string | null;
  /** Public JPEG URL when the Mini App uploaded a card. */
  cardUrl?: string | null;
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

/** The same distance the register's personal strip prints. */
const gapOf = (value: number | null): string | null => {
  if (value == null) return null;
  const diff = Math.round((value - 75) * 10) / 10;
  if (diff === 0) return "on the 75% line";
  return diff > 0
    ? `${diff.toFixed(1)} above 75%`
    : `${Math.abs(diff).toFixed(1)} below 75%`;
};

/**
 * "Attendance rank in CSE · Year 3 · Section A" for a section board;
 * "Attendance rank · All students" otherwise. The scope is not decoration:
 * `#4 of 63` means something only with the board attached.
 */
const headingOf = ({
  sort,
  scope,
  scopeLabel,
}: {
  sort: RankSort;
  scope?: RankScope;
  scopeLabel?: string | null;
}): string =>
  scope === "section" && scopeLabel
    ? `${labelOf(sort)} in ${scopeLabel}`
    : `${labelOf(sort)} · All students`;

const replyMarkup = () => ({
  inline_keyboard: [
    [{ text: "Open the register", url: appDirectLink("rank") }],
  ],
});

/**
 * The card a student can share to any chat or story.
 *
 * It carries the roll and the board's figure, never a name: the student chose
 * to share the number, not their classmate's identity. An uploaded card rides
 * as a photo; without one the message stays a text article, so older clients
 * keep working.
 */
export const buildRankShare = ({
  roll,
  sort,
  rank,
  total,
  value,
  scope = "all",
  scopeLabel = null,
  cardUrl = null,
}: RankShareInput): InlineQueryResultArticle | InlineQueryResultPhoto => {
  const score = scoreOf(value, sort);
  const gap = sort === "attendance" ? gapOf(value) : null;
  const heading = headingOf({ sort, scope, scopeLabel });
  const totalText = total.toLocaleString("en-IN");
  const summary = `#${rank} of ${totalText}${score ? ` · ${score}` : ""}`;
  const detail = [score, gap].filter(Boolean).join(" · ");

  const message =
    `🏆 <b>${escapeHtml(heading)}</b>\n` +
    `<code>${escapeHtml(roll)}</code>\n` +
    `<b>#${rank}</b> of ${totalText}${detail ? ` · ${detail}` : ""}\n\n` +
    `<i>Open the register to see where you stand.</i>`;

  if (cardUrl) {
    return {
      type: "photo",
      id: `rank-${sort}-${roll}`,
      photo_url: cardUrl,
      thumbnail_url: cardUrl,
      photo_width: 1080,
      photo_height: 1920,
      title: `My ${labelOf(sort).toLowerCase()}`,
      description: summary,
      caption: message,
      parse_mode: "HTML",
      reply_markup: replyMarkup(),
    };
  }

  return {
    type: "article",
    id: `rank-${sort}-${roll}`,
    title: `My ${labelOf(sort).toLowerCase()}`,
    description: summary,
    input_message_content: {
      message_text: message,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    },
    reply_markup: replyMarkup(),
  };
};

/** The section label and the filters the list uses, or null. */
const resolveSection = async (
  roll: string,
): Promise<{ filters: LeaderboardFilters; label: string } | null> => {
  try {
    const student = await getStudentCached(roll);
    const year = yearDigit(student.year);
    const branch = student.branch == null ? "" : String(student.branch).trim();
    const section =
      student.section == null ? "" : String(student.section).trim();
    if (!year || !branch || !section) return null;

    const branchName = BRANCHES[Number(branch)] ?? branch;
    return {
      filters: { year, branch, section },
      label: `${branchName} · Year ${year} · Section ${section}`,
    };
  } catch (e) {
    logger.debug("[rank] section lookup failed:", e);
    return null;
  }
};

export type PrepareRankShareResult =
  | { ok: true; share: PreparedRankShare }
  | { ok: false; status: number; error: string };

export interface PrepareRankShareOptions {
  scope?: RankScope;
  /** The uploaded card URL, after ownership has been checked. */
  cardUrl?: string | null;
}

/**
 * Build and store a prepared message for this student.
 *
 * Telegram keeps the prepared id for a short while; the Mini App hands it to
 * `shareMessage` right away, so the expiry is informational. The rank is
 * resolved here, never taken from the client: the section scope asks the same
 * filtered model the register uses.
 */
export const prepareRankShare = async (
  userId: number,
  sort: RankSort,
  options: PrepareRankShareOptions = {},
): Promise<PrepareRankShareResult> => {
  const registration = await getRegistration(String(userId));
  if (!registration) {
    return {
      ok: false,
      status: 400,
      error: "Save your roll number first, then you can share your rank.",
    };
  }

  const requestedSection =
    options.scope === "section"
      ? await resolveSection(registration.roll_no)
      : null;

  const rank = await getStudentRank(
    registration.roll_no,
    sort,
    requestedSection?.filters,
  );
  if (!rank) {
    return {
      ok: false,
      status: 404,
      error: "No rank yet. Check your figure once, then try again.",
    };
  }

  // A section that cannot be resolved falls back to the whole register
  // rather than shipping a figure with no board attached.
  const scope: RankScope = requestedSection ? "section" : "all";
  const scopeLabel = requestedSection?.label ?? "All students";
  const cardUrl = options.cardUrl?.trim() || null;

  const store = async (url: string | null) => {
    const result = buildRankShare({
      roll: registration.roll_no,
      sort,
      ...rank,
      scope,
      scopeLabel,
      cardUrl: url,
    });
    return bot.api.savePreparedInlineMessage({
      user_id: userId,
      result,
      allow_user_chats: true,
      allow_group_chats: true,
      allow_channel_chats: true,
    });
  };

  let prepared: Awaited<ReturnType<typeof store>>;
  try {
    prepared = await store(cardUrl);
  } catch (error) {
    if (!cardUrl) throw error;
    // Telegram could not fetch the photo. A text card is still worth sending.
    logger.warn(
      "[rank] photo share failed; falling back to text:",
      error instanceof Error ? error.message : error,
    );
    prepared = await store(null);
  }

  return {
    ok: true,
    share: { id: prepared.id, expiresAt: prepared.expiration_date },
  };
};
