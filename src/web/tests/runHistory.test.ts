import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunHistory } from "../src/components/RunHistory";
import type { GameRun } from "../src/api";

const run = (over: Partial<GameRun> = {}): GameRun => ({
  id: 1,
  dayKey: "2026-11-25",
  score: 814,
  points: 1_450,
  correct: 8,
  total: 10,
  streak: 2,
  finishedAt: "2026-11-25T10:10:00.000Z",
  ...over,
});

const render = (runs: GameRun[]): string =>
  renderToStaticMarkup(React.createElement(RunHistory, { runs }));

describe("RunHistory", () => {
  it("prints each run's day, correctness, score and points", () => {
    const html = render([run()]);

    expect(html).toContain("Your runs");
    expect(html).toContain("25 Nov");
    expect(html).toContain("8 of 10 correct");
    expect(html).toContain("814 score");
    expect(html).toContain("1,450");
    expect(html).toContain("pts");
    expect(html).toContain('id="runs"');
    expect(html).toContain('href="#/runs/1"');
    expect(html).toContain('href="#/runs"');
  });

  it("keeps the newest run first and pluralises the count", () => {
    const html = render([
      run({ id: 2, dayKey: "2026-11-25", score: 1_000 }),
      run({ id: 1, dayKey: "2026-11-24", score: 900 }),
    ]);

    expect(html.indexOf("25 Nov")).toBeLessThan(html.indexOf("24 Nov"));
    expect(html).toContain("2 runs");
    expect(html).toContain('href="#/runs/2"');
    expect(html).toContain('href="#/runs/1"');
  });

  it("invites today's run when there are none", () => {
    const html = render([]);

    expect(html).toContain("No runs yet.");
    expect(html).toContain('href="#/play"');
    expect(html).not.toContain("run-group");
  });
});
