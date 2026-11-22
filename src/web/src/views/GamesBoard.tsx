import { useEffect, useState } from "react";
import { API_BASE } from "../api";
import { ErrorState, SkeletonRows } from "../components/FeedbackStates";
import { plural } from "../format";
import { fetchWithTimeout, readJson, RequestError } from "../http";
import { haptic } from "../telegram";

/**
 * The league board, opened from the channel's "Full leaderboard" button.
 *
 * It is a hidden page: the channel names it in a `startapp` link, so it has no
 * tab of its own. A row shows the chosen display name and the full roll; the
 * one exception is a verified owner's hide-in-the-leaderboard switch, whose
 * roll stays masked. The week's boards are public, so the page needs no
 * Telegram identity to read.
 */

export interface BoardPlayer {
  /** The chosen display name, or the roll when there is none. */
  name: string;
  /** The full roll, or the masked one when its owner hid the leaderboard. */
  roll: string;
  points: number;
}

export interface BoardSection {
  label: string;
  points: number;
  players: number;
  /** Only the number-one section carries its top players. */
  topPlayers?: BoardPlayer[];
}

export interface BoardPayload {
  weekLabel: string;
  players: BoardPlayer[];
  sections: BoardSection[];
}

type Load =
  | { state: "loading" }
  | { state: "error"; message: string | null }
  | { state: "ready"; board: BoardPayload };

const score = (value: number): string => value.toLocaleString("en-IN");

const BoardRow = ({
  rank,
  title,
  sub,
  points,
}: {
  rank: number;
  title: string;
  sub?: string;
  points: number;
}) => (
  <li className={`tg-row${rank === 1 ? " tg-row--first" : ""}`}>
    <span
      className={`tg-rank-badge${rank === 1 ? " tg-rank-badge--first" : ""}`}
    >
      {rank}
    </span>
    <span className="tg-row__body">
      <span className="tg-row__title">{title}</span>
      {sub ? <span className="tg-row__sub">{sub}</span> : null}
    </span>
    <span className="tg-row__score">{score(points)}</span>
  </li>
);

export type BoardTab = "sections" | "players";

/**
 * The two boards on one page, switched by the same pills the register uses.
 * Sections lead and are the default: Section Wars is the team game, and the
 * player table is the detail you open when you want it.
 */
const BOARD_TABS: { id: BoardTab; label: string }[] = [
  { id: "sections", label: "Sections" },
  { id: "players", label: "Players" },
];

/**
 * The number-one section, with its three players nested under it the way a
 * file tree nests children. Only this section expands, so the board stays
 * short while the leader still shows who carried it.
 */
const LeaderSection = ({
  section,
  players,
}: {
  section: BoardSection;
  players: BoardPlayer[];
}) => (
  <li className="tg-tree-node">
    <div className="tg-row tg-row--first">
      <span className="tg-rank-badge tg-rank-badge--first">1</span>
      <span className="tg-row__body">
        <span className="tg-row__title">{section.label}</span>
        <span className="tg-row__sub">{plural(section.players, "player")}</span>
      </span>
      <span className="tg-row__score">{score(section.points)}</span>
    </div>
    <ol
      className="tg-tree-children"
      aria-label={`Top players in ${section.label}`}
    >
      {players.map((player, index) => (
        <li key={`${player.roll}-${index}`} className="tg-row tg-row--child">
          <span className="tg-tree-rank">{index + 1}</span>
          <span className="tg-row__body">
            <span className="tg-row__title">{player.name}</span>
            {player.name === player.roll ? null : (
              <span className="tg-row__sub">{player.roll}</span>
            )}
          </span>
          <span className="tg-row__score">{score(player.points)}</span>
        </li>
      ))}
    </ol>
  </li>
);

/**
 * The board itself, without the fetch. Pure so a server-render test can prove
 * the rows, the default tab and the empty week survive a render.
 */
export const GamesBoardView = ({
  board,
  tab,
  onTabChange,
}: {
  board: BoardPayload;
  tab: BoardTab;
  onTabChange: (tab: BoardTab) => void;
}) => {
  const empty = board.players.length === 0 && board.sections.length === 0;

  return (
    <div className="reg-body">
      <div className="tg-board-switch">
        <div className="tg-pills" role="group" aria-label="Board">
          {BOARD_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="tg-pill"
              aria-pressed={tab === entry.id}
              onClick={() => onTabChange(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p className="tg-hint">{board.weekLabel} · updated as runs land.</p>
      </div>

      {empty ? (
        <div className="state-block">
          <p className="title">No one has played this week yet</p>
          <p className="sub">
            The boards fill as students finish runs. Play today&rsquo;s run from
            the channel.
          </p>
        </div>
      ) : tab === "sections" ? (
        <>
          <section className="tg-section">
            <div className="tg-section-head">
              <h2 className="tg-section-title">Sections</h2>
              <span className="tg-section-count">
                {board.sections.length > 0
                  ? plural(board.sections.length, "section")
                  : "No rows yet"}
              </span>
            </div>
            {board.sections.length > 0 ? (
              <ol className="tg-group" aria-label="Section Wars standings">
                {board.sections.map((section, index) => {
                  const top = section.topPlayers;
                  if (index === 0 && top && top.length > 0) {
                    return (
                      <LeaderSection
                        key={section.label}
                        section={section}
                        players={top}
                      />
                    );
                  }
                  return (
                    <BoardRow
                      key={section.label}
                      rank={index + 1}
                      title={section.label}
                      sub={plural(section.players, "player")}
                      points={section.points}
                    />
                  );
                })}
              </ol>
            ) : (
              <p className="tg-hint" style={{ margin: "0 16px" }}>
                No section has scored this week yet.
              </p>
            )}
            <p className="tg-hint" style={{ margin: "8px 16px 0" }}>
              Section Wars counts each section&rsquo;s best ten players.
            </p>
          </section>
        </>
      ) : (
        <section className="tg-section">
          <div className="tg-section-head">
            <h2 className="tg-section-title">Players</h2>
            <span className="tg-section-count">
              {board.players.length > 0
                ? `Top ${board.players.length}`
                : "No rows yet"}
            </span>
          </div>
          {board.players.length > 0 ? (
            <ol
              className="tg-group"
              aria-label="Students ranked by points this week"
            >
              {board.players.map((player, index) => (
                <BoardRow
                  key={`${player.roll}-${index}`}
                  rank={index + 1}
                  title={player.name}
                  // A chosen name gets the masked roll under it; a masked
                  // roll as the title would otherwise repeat itself.
                  sub={player.name === player.roll ? undefined : player.roll}
                  points={player.points}
                />
              ))}
            </ol>
          ) : (
            <p className="tg-hint" style={{ margin: "0 16px" }}>
              No one has scored this week yet.
            </p>
          )}
        </section>
      )}
    </div>
  );
};

export default function GamesBoard() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // Sections are the default board; switching is local, the data is one fetch.
  const [tab, setTab] = useState<BoardTab>("sections");
  // Bumping this re-runs the effect below; the retry button is the only writer.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    const read = async (): Promise<void> => {
      try {
        const res = await fetchWithTimeout(`${API_BASE}/api/games/board`, {
          signal: controller.signal,
        });
        const body = await readJson<BoardPayload & { success: true }>(res);
        setLoad({ state: "ready", board: body });
      } catch (e) {
        if (controller.signal.aborted) return;
        setLoad({
          state: "error",
          message: e instanceof RequestError ? e.message : null,
        });
      }
    };

    void read();
    return () => controller.abort();
  }, [attempt]);

  const retry = (): void => {
    haptic.tap();
    setLoad({ state: "loading" });
    setAttempt((count) => count + 1);
  };

  if (load.state === "loading") {
    return (
      <div className="reg-body">
        <SkeletonRows />
      </div>
    );
  }

  if (load.state === "error") {
    return (
      <div className="reg-body">
        <ErrorState onRetry={retry} message={load.message} />
      </div>
    );
  }

  const selectTab = (next: BoardTab): void => {
    if (next === tab) return;
    haptic.select();
    setTab(next);
  };

  return (
    <GamesBoardView board={load.board} tab={tab} onTabChange={selectTab} />
  );
}
