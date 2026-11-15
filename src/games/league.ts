import {
  getGamePlayer,
  getPlayerWeek,
  getSectionWeek,
  getWeekPlayers,
  getWeekSections,
} from "../db/game.model.js";
import { leagueCard, weekLabel } from "./cards.js";
import { seasonKey } from "./config.js";
import { sendOrEdit } from "./play.js";
import { loadPlayer } from "./player.js";
import { istStamp } from "./time.js";

/**
 * The weekly board in the private chat.
 *
 * The board is public; the personal lines are not. A group that asks for it
 * gets a private link instead, so a section mate never sees another student's
 * rank or points.
 */
export const sendLeague = async ({
  chatId,
  userId,
  replyTo,
}: {
  chatId: number;
  userId: number;
  replyTo?: number;
}): Promise<void> => {
  const stamp = istStamp();
  const season = seasonKey();

  const [players, sections, me] = await Promise.all([
    getWeekPlayers(season, stamp.week, 5),
    getWeekSections(season, stamp.week, 5),
    getPlayerWeek(season, stamp.week, userId),
  ]);

  const identity =
    (await loadPlayer(userId).catch(() => null)) ??
    (await getGamePlayer(userId));
  const sectionKey = identity?.sectionKey ?? null;
  const sectionLabel = identity?.sectionLabel ?? null;

  const mySection =
    sectionKey && sectionLabel
      ? await getSectionWeek(season, stamp.week, sectionKey)
      : null;

  await sendOrEdit({
    chatId,
    replyTo,
    card: leagueCard({
      label: weekLabel(stamp.monday),
      sections,
      players,
      me,
      mySection:
        mySection && sectionLabel
          ? { ...mySection, label: sectionLabel }
          : null,
    }),
  });
};
