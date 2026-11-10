import type { MyRank } from "./api";
import { useIdentity } from "./identity";

interface TelegramUser {
  myRoll: string | null;
  myRank: MyRank | null;
  /** How the server resolved this caller: a saved roll only. */
  source: "registered" | null;
  /** True while the shell is still checking the roll. */
  loading: boolean;
  error: string | null;
}

/**
 * "You are #N" for the rank strip.
 *
 * The real fetch lives in `IdentityProvider`; this is the thin shape the
 * leaderboard already consumes. One app open asks `/api/me` once, no matter
 * how many views read the answer.
 */
export const useTelegramUser = (): TelegramUser => {
  const { roll, ranks, source, status, error } = useIdentity();

  return {
    myRoll: roll,
    myRank: ranks,
    source,
    loading: status === "loading",
    error: status === "error" ? error : null,
  };
};
