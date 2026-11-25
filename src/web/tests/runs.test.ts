import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunsView } from "../src/views/Runs";
import type { GameRunDetail } from "../src/api";

const run: GameRunDetail = {
  id: 7,
  dayKey: "2026-11-25",
  score: 1_030,
  points: 1_442,
  streak: 5,
  correct: 8,
  total: 10,
  finishedAt: "2026-11-25T10:10:00.000Z",
  durationMs: 47_000,
  questions: [
    {
      index: 1,
      prompt: "Which one is correct?",
      options: ["Right", "Wrong", "Also wrong", "Still wrong"],
      correctIndex: 0,
      chosenIndex: 0,
      correct: true,
      ms: 4_200,
      points: 150,
    },
    {
      index: 2,
      prompt: "Which one is wrong?",
      options: ["Right", "Wrong", "Also wrong", "Still wrong"],
      correctIndex: 1,
      chosenIndex: 2,
      correct: false,
      ms: 12_000,
      points: 0,
    },
  ],
};

const render = (view: Parameters<typeof RunsView>[0]["view"]): string =>
  renderToStaticMarkup(React.createElement(RunsView, { view }));

describe("RunsView", () => {
  it("prints the run and every question with its answer", () => {
    const html = render({ kind: "ready", runs: [run] });

    expect(html).toContain("Your runs");
    expect(html).toContain("25 Nov");
    expect(html).toContain("8 of 10 correct");
    expect(html).toContain("1,030 score");
    expect(html).toContain("best 5 in a row");
    expect(html).toContain("1,442");
    expect(html).toContain("47s");
    expect(html).toContain("Which one is correct?");
    expect(html).toContain("Correct");
    expect(html).toContain("chose A.");
    expect(html).toContain("4.2s");
    expect(html).toContain("Which one is wrong?");
    expect(html).toContain("Wrong");
    expect(html).toContain("timeout");
    expect(html).toContain("Correct: B. Wrong");
    expect(html.match(/<details /g)).toHaveLength(1);
  });

  it("invites the run when the history is empty", () => {
    const html = render({ kind: "ready", runs: [] });

    expect(html).toContain("No runs yet");
    expect(html).toContain('href="#/play"');
  });

  it("says it needs Telegram and offers a retry on failure", () => {
    expect(render({ kind: "needs-telegram" })).toContain(
      "Open this inside Telegram",
    );
    expect(render({ kind: "error" })).toContain("Try again");
  });
});
