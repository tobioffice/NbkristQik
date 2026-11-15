import type { SectionRef } from "./types.js";
import { previousDateKey } from "./time.js";
import { BRANCHES } from "../constants/index.js";

/**
 * Scoring rules in one place, so the card, the tests and the channel post
 * cannot drift.
 *
 * A correct answer is worth 100. Speed adds up to 50 more, fading to zero at
 * 20 seconds. Accuracy still beats reflexes: a slow correct answer (100)
 * beats a fast wrong one (0), and the speed bonus is capped below the value
 * of another correct answer.
 */

export const QUESTION_LIMIT_MS = 20_000;
export const CORRECT_POINTS = 100;
export const MAX_SPEED_BONUS = 50;
export const QUESTIONS_PER_RUN = 5;

export const DUEL_WIN_POINTS = 200;
export const DUEL_LOSS_POINTS = 75;
export const DUEL_DRAW_POINTS = 125;

/** Points for one answer. */
export const answerPoints = (correct: boolean, elapsedMs: number): number => {
  if (!correct) return 0;
  const elapsed = Math.max(0, Math.min(QUESTION_LIMIT_MS, elapsedMs));
  const bonus = Math.round(MAX_SPEED_BONUS * (1 - elapsed / QUESTION_LIMIT_MS));
  return CORRECT_POINTS + bonus;
};

/** 1.0 on day one, +10% per extra streak day, capped at 1.5x. */
export const streakMultiplier = (streak: number): number =>
  1 + Math.min(Math.max(streak - 1, 0), 5) * 0.1;

/** The season points a finished Five run is worth. */
export const fivePoints = (baseScore: number, streak: number): number =>
  Math.round(baseScore * streakMultiplier(streak));

/** The next streak value for a run finished on `today`. */
export const nextStreak = (
  lastFive: string | null,
  today: string,
  current: number,
): number => {
  if (lastFive === today) return Math.max(current, 1);
  if (lastFive === previousDateKey(today)) return Math.max(current, 0) + 1;
  return 1;
};

export type DuelWinner = "challenger" | "opponent" | "draw";

export interface DuelOutcome {
  winner: DuelWinner;
  challengerPoints: number;
  opponentPoints: number;
}

/** Who won a duel and what each side earns. */
export const duelOutcome = (
  challengerScore: number,
  opponentScore: number,
): DuelOutcome => {
  if (challengerScore === opponentScore) {
    return {
      winner: "draw",
      challengerPoints: DUEL_DRAW_POINTS,
      opponentPoints: DUEL_DRAW_POINTS,
    };
  }

  const challengerWon = challengerScore > opponentScore;
  return {
    winner: challengerWon ? "challenger" : "opponent",
    challengerPoints: challengerWon ? DUEL_WIN_POINTS : DUEL_LOSS_POINTS,
    opponentPoints: challengerWon ? DUEL_LOSS_POINTS : DUEL_WIN_POINTS,
  };
};

/** The label part in a section key: letters and digits only, uppercase. */
const keyPart = (value: unknown): string =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/** The display part: underscores become spaces, runs squeezed, trimmed. */
const prettyPart = (value: unknown): string =>
  String(value ?? "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The team a student plays for: year, branch and section, e.g. `4 CSE C`.
 *
 * The portal packs the year and semester into one string (`42` = 4th year,
 * 2nd semester), so only the first digit is the team's year. The branch is a
 * numeric department code (`5`), and `BRANCHES` is the one place the college's
 * codes become names. A record missing any part is not a team; the run still
 * counts for the individual board.
 */
export const sectionRefOf = (student: {
  year?: unknown;
  branch?: unknown;
  section?: unknown;
}): SectionRef | null => {
  const year = /^([1-4])/.exec(String(student.year ?? "").trim())?.[1];
  const rawBranch = String(student.branch ?? "").trim();
  const branchName = BRANCHES[Number(rawBranch)] ?? rawBranch;
  const branchKey = keyPart(branchName);
  const sectionKey = keyPart(student.section);
  if (!year || !branchKey || !sectionKey) return null;

  const branch = prettyPart(branchName);
  const section = prettyPart(student.section);
  return {
    key: `${year}|${branchKey}|${sectionKey}`,
    label: `${year} ${branch} ${section}`.replace(/\s+/g, " ").trim(),
  };
};

/**
 * A roll number with its last three characters hidden.
 *
 * The channel is public and a full roll is enough to find a student; the
 * league shows the display name a student chose, or this. The portal name is
 * never printed outside a private chat.
 */
export const maskRoll = (roll: string): string => {
  const clean = roll.trim().toUpperCase();
  if (clean.length <= 3) return clean;
  return `${clean.slice(0, -3)}•••`;
};

/** What a public board calls a player. */
export const publicName = (
  displayName: string | null | undefined,
  roll: string,
): string => {
  const chosen = displayName?.trim();
  return chosen ? chosen : maskRoll(roll);
};

/** "18s", "1m 04s". */
export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${Math.max(total, 1)}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
};
