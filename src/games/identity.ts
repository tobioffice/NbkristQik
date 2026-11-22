import { getBotUserNames } from "../db/botUsers.model.js";
import { getRollClaimStates } from "../db/rollClaim.model.js";

/**
 * Adds what a board row needs to name its player: whether the roll was proved,
 * whether the owner hid the leaderboard, and the stored Telegram profile for
 * an unverified name.
 *
 * The games data itself stays unaware of claims and profiles; this reads them
 * once per board, for the rows on screen.
 */
export const withBoardIdentities = async <
  T extends { userId: number; rollNo: string },
>(
  players: T[],
): Promise<
  (T & {
    verified: boolean;
    hidden: boolean;
    firstName: string | null;
    username: string | null;
  })[]
> => {
  if (players.length === 0) return [];

  const [claims, profiles] = await Promise.all([
    getRollClaimStates(players.map((player) => player.rollNo)),
    getBotUserNames(players.map((player) => player.userId)),
  ]);

  return players.map((player) => {
    const claim = claims.get(player.rollNo.trim().toUpperCase());
    const profile = profiles.get(player.userId);
    return {
      ...player,
      verified: claim !== undefined,
      hidden: claim?.hidden ?? false,
      firstName: profile?.firstName ?? null,
      username: profile?.username ?? null,
    };
  });
};
