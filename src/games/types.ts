/** Shapes shared by the game store, the cards and the flows. */

export type GameKind = "five" | "duel";

export interface GameQuestion {
  id: number;
  prompt: string;
  options: string[];
  correct: number;
  topic: string;
}

export interface GameAttempt {
  id: number;
  game: GameKind;
  roundKey: string;
  dayKey: string;
  weekKey: string;
  season: string;
  userId: number;
  rollNo: string;
  sectionKey: string | null;
  sectionLabel: string | null;
  questionIds: number[];
  answers: AttemptAnswer[];
  idx: number;
  score: number;
  points: number;
  streak: number;
  duelId: number | null;
  status: "active" | "done";
  startedAt: string;
  shownAt: string | null;
  finishedAt: string | null;
}

/** One answered question, stored in the attempt's `answers` JSON. */
export interface AttemptAnswer {
  option: number;
  correct: boolean;
  ms: number;
  points: number;
}

export interface GameDuel {
  id: number;
  challengerId: number;
  challengerRoll: string;
  challengerName: string | null;
  challengerSectionKey: string | null;
  challengerSectionLabel: string | null;
  challengerScore: number;
  questionIds: number[];
  dayKey: string;
  weekKey: string;
  season: string;
  status: "open" | "done" | "expired";
  opponentId: number | null;
  opponentRoll: string | null;
  opponentName: string | null;
  opponentScore: number | null;
  winnerId: number | null;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string;
}

export interface GamePlayer {
  userId: number;
  rollNo: string;
  displayName: string | null;
  sectionKey: string | null;
  sectionLabel: string | null;
  streak: number;
  bestStreak: number;
  lastFive: string | null;
}

/** A row on the weekly player board. */
export interface BoardPlayer {
  userId: number;
  rollNo: string;
  displayName: string | null;
  points: number;
  /** Finished daily runs this week; the board's "played" count. A duel is a
   * match, not a run, so it adds nothing here. */
  plays: number;
  /** True when the owner hid the leaderboard row; only its roll is masked. */
  hidden?: boolean;
  /** True when the roll was proved by its college email. */
  verified?: boolean;
  /** The stored Telegram name/handle, for a player with no display name. */
  firstName?: string | null;
  username?: string | null;
}

/** A row on the weekly section board. */
export interface BoardSection {
  key: string;
  label: string;
  points: number;
  players: number;
}

export interface SectionRef {
  key: string;
  label: string;
}
