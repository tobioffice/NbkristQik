import type { GameLive } from "./api";

/**
 * The home banner's words and destination for one league answer.
 *
 * Kept apart from the view so the copy can be tested as data and the React
 * file stays a component module (fast refresh). Every branch is an in-app
 * address: the Mini App plays the run itself, and a finished run leads to the
 * profile's run history.
 */

/** The in-app play screen; it resumes an active run or shows the result. */
export const PLAY_LINK = "#/play";
/** The profile screen, where a finished run's history is listed. */
export const PROFILE_LINK = "#/";

const formatPoints = (value: number): string => value.toLocaleString("en-IN");

export interface BannerContent {
  href: string;
  /** The trailing action word: Play, Resume or Your runs. */
  action: string;
  /** One quiet line of state under the game's name. */
  line: string;
}

/**
 * Before the answer lands (and after a failed read) the banner invites the
 * run itself; the play screen turns that tap into whatever the account needs
 * next, including the roll prompt.
 */
export const bannerContent = (live: GameLive | null): BannerContent => {
  if (live?.me && !live.me.registered) {
    return {
      href: PLAY_LINK,
      action: "Play",
      line: "Save your roll to play today's run.",
    };
  }

  const run = live?.me?.run ?? null;

  if (run?.state === "playing") {
    return {
      href: PLAY_LINK,
      action: "Resume",
      line: `Question ${run.question ?? 1} of ${run.questions} is waiting.`,
    };
  }

  if (run?.state === "done") {
    return {
      href: PROFILE_LINK,
      action: "Your runs",
      line: `Run done: ${formatPoints(run.points ?? 0)} points.`,
    };
  }

  return {
    href: PLAY_LINK,
    action: "Play",
    line: "Today's run is open. 10 questions, 10 seconds each.",
  };
};
