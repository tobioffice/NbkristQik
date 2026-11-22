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
 * the two boards and the empty week survive without a DOM.
 */

const board: BoardPayload = {
  weekLabel: "Week of 16 Nov",
  players: [
    { name: "Qik player", roll: "23KB1A0599", points: 2_100 },
    // the owner hid the leaderboard row: only the roll stays masked
    { name: "23KB1A0•••", roll: "23KB1A0•••", points: 1_860 },
    { name: "Asha", roll: "23KB1A0600", points: 1_740 },
  ],
  sections: [
    {
      label: "4 CSE C",
      points: 4_820,
      players: 9,
      // Only the leading section carries its players.
      topPlayers: [
        { name: "Lakshmi", roll: "23KB1A0700", points: 1_240 },
        { name: "23KB1A0•••", roll: "23KB1A0•••", points: 1_100 },
      ],
    },
    { label: "3 ECE A", points: 4_610, players: 8 },
  ],
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
    expect(html).not.toContain("Qik player");
    expect(html).not.toContain("Top 3");

    // only the number-one section nests its top three players under it
    expect(html.match(/tg-tree-node/g)).toHaveLength(1);
    expect(html).toContain("tg-tree-children");
    expect(html).toContain("tg-row--child");
    expect(html).toContain("Lakshmi");
    expect(html).toContain("1,240");
  });

  it("switches to the players board", () => {
    const html = render(board, "players");

    expect(html).toContain('aria-pressed="true">Players</button>');
    expect(html).toContain("Qik player");
    expect(html).toContain("2,100");
    // full rolls, with the hidden owner's one masked
    expect(html).toContain("23KB1A0599");
    expect(html).toContain("23KB1A0600");
    expect(html).toContain("23KB1A0•••");
    expect(html).toContain("Top 3");
    expect(html).not.toContain("4 CSE C");
    expect(html).not.toContain("tg-tree-node");
  });

  it("does not repeat a masked roll when it is already the name", () => {
    const html = render(
      {
        ...board,
        players: [{ name: "23KB1A0•••", roll: "23KB1A0•••", points: 2_100 }],
        sections: [],
      },
      "players",
    );

    // one title, no sub line repeating the same masked roll
    expect(html).not.toContain("tg-row__sub");
  });

  it("writes the empty week as one line, with the switch still there", () => {
    const html = render({
      weekLabel: "Week of 16 Nov",
      players: [],
      sections: [],
    });

    expect(html).toContain("No one has played this week yet");
    expect(html).toContain("Sections");
    expect(html).toContain("Players");
    expect(html).not.toContain("tg-group");
  });
});
