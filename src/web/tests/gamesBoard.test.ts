import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  GamesBoardView,
  type BoardPayload,
  type BoardTab,
} from "../src/views/GamesBoard";

/**
 * The hidden league board's markup. Server-rendering proves the default tab,
 * the two boards, the paged foot and the empty week survive without a DOM.
 */

const board: BoardPayload = {
  weekLabel: "Week of 16 Nov",
  players: [
    // verified by college email: named by the roll
    { name: "23KB1A0599", points: 2_100 },
    // verified, but hidden: the roll stays masked
    { name: "23KB1A0•••", points: 1_860 },
    // unverified: Telegram first name, then @username
    { name: "Ravi", points: 1_740 },
  ],
  sections: [
    {
      label: "4 CSE C",
      points: 4_820,
      players: 9,
      // Only the leading section carries its players.
      topPlayers: [
        { name: "23KB1A0700", points: 1_240 },
        { name: "@ghost", points: 1_100 },
      ],
    },
    { label: "3 ECE A", points: 4_610, players: 8 },
  ],
  playerTotal: 3,
  playerPage: 1,
  playerPageSize: 50,
  hasMorePlayers: false,
};

const render = (payload: BoardPayload, tab: BoardTab = "sections"): string =>
  renderToStaticMarkup(
    React.createElement(GamesBoardView, {
      board: payload,
      tab,
      onTabChange: () => undefined,
    }),
  );

describe("GamesBoardView", () => {
  it("opens on the sections board", () => {
    const html = render(board);

    expect(html).toContain('aria-pressed="true">Sections</button>');
    expect(html).toContain("4 CSE C");
    expect(html).toContain("4,820");
    expect(html).toContain("9 players");
    expect(html).toContain("2 sections");
    expect(html).not.toContain("Ravi");

    // only the number-one section nests its top three players under it
    expect(html.match(/tg-tree-node/g)).toHaveLength(1);
    expect(html).toContain("tg-tree-children");
    expect(html).toContain("tg-row--child");
    expect(html).toContain("23KB1A0700");
    expect(html).toContain("@ghost");
    expect(html).toContain("1,240");
  });

  it("switches to the players board", () => {
    const html = render(board, "players");

    expect(html).toContain('aria-pressed="true">Players</button>');
    // verified roll, masked hidden roll, and a Telegram name
    expect(html).toContain("23KB1A0599");
    expect(html).toContain("23KB1A0•••");
    expect(html).toContain("Ravi");
    expect(html).toContain("2,100");
    // one identity per row, no second line
    expect(html).not.toContain("tg-row__sub");
    expect(html).toContain("That’s everyone on this week’s board.");
    expect(html).not.toContain("4 CSE C");
    expect(html).not.toContain("tg-tree-node");
  });

  it("offers the next page while more players exist", () => {
    const html = render(
      { ...board, playerTotal: 120, hasMorePlayers: true },
      "players",
    );

    expect(html).toContain("Load more");
    expect(html).toContain("Showing 3 of 120.");
    expect(html).not.toContain("That’s everyone");
  });

  it("shows the failed-page retry", () => {
    const html = renderToStaticMarkup(
      React.createElement(GamesBoardView, {
        board: { ...board, playerTotal: 120, hasMorePlayers: true },
        tab: "players",
        onTabChange: () => undefined,
        moreError: true,
      }),
    );

    expect(html).toContain("The next page didn’t load.");
    expect(html).toContain("Try again");
  });

  it("writes the empty week as one line, with the switch still there", () => {
    const html = render({
      weekLabel: "Week of 16 Nov",
      players: [],
      sections: [],
      playerTotal: 0,
      playerPage: 1,
      playerPageSize: 50,
      hasMorePlayers: false,
    });

    expect(html).toContain("No one has played this week yet");
    expect(html).toContain("Sections");
    expect(html).toContain("Players");
    expect(html).not.toContain("tg-group");
  });
});
