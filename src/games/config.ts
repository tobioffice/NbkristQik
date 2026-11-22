/** League settings that come from the environment. */

/** The season key that groups a run of weekly boards. */
export const seasonKey = (): string => process.env.GAME_SEASON?.trim() || "S1";

/** The live channel board is opt-in: a test deploy must not touch the real
 * channel. */
export const channelPostsEnabled = (): boolean =>
  process.env.GAME_CHANNEL_POSTS?.trim().toLowerCase() === "on";
