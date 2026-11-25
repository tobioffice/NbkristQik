import { useEffect, useState } from "react";
import { getGameLive, type GameLive } from "../api";
import { istWeekDayLabel, istWeekLabel } from "../format";
import { bannerContent } from "../gameBanner";
import { haptic } from "../telegram";

/**
 * The home screen's one banner: the league that is on this week, and the way
 * into today's run.
 *
 * The whole banner is one link. A run in play or not yet started opens the
 * play screen inside this app; a finished run opens the runs page, where every
 * question and answer from the run is listed. The banner paints before its
 * answer lands, so the fallback copy is a real invitation for every caller
 * (the play screen resumes a run, shows a finished one, or asks for a roll),
 * and the height is reserved so the page does not jump under the reader.
 */

const FlagIcon = () => (
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 21V4" />
    <path d="M6 4h10l-2.5 4L16 12H6" />
  </svg>
);

const ChevronIcon = () => (
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const GameBannerView = ({ live }: { live: GameLive | null }) => {
  const content = bannerContent(live);
  const week = live?.weekLabel ?? istWeekLabel();

  const onClick = () => {
    haptic.tap();
  };

  return (
    <div className="game-banner-slot">
      <a className="game-banner" href={content.href} onClick={onClick}>
        <span className="game-banner__icon">
          <FlagIcon />
        </span>
        <span className="game-banner__body">
          <span className="game-banner__title">Section Wars</span>
          <span className="game-banner__line">{content.line}</span>
        </span>
        <span className="game-banner__end">
          <span className="game-banner__week">{week}</span>
          <span className="game-banner__day">{istWeekDayLabel()}</span>
          <span className="game-banner__action">
            {content.action}
            <ChevronIcon />
          </span>
        </span>
      </a>
    </div>
  );
};

/**
 * The banner's data half. Identity arrives after the Telegram SDK does, so the
 * request starts again when it does; an aborted read is a tab switch, not an
 * error. The painted copy stays usable while a new answer is on the way.
 */
export default function GameBanner({
  tgUser,
  initData,
}: {
  tgUser: string | null;
  initData?: string;
}) {
  const [live, setLive] = useState<GameLive | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    getGameLive({ userId: tgUser ?? undefined, initData }, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setLive(answer);
      })
      .catch(() => {
        // A failed read leaves the fallback banner in place: it still opens
        // the run, so there is nothing to report.
      });

    return () => controller.abort();
  }, [tgUser, initData]);

  return <GameBannerView live={live} />;
}
