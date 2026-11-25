import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PlayRunView,
  type PlayView,
  type PlayRunViewProps,
} from "../src/views/PlayRun";
import type { FiveQuestion, FiveResult } from "../src/api";

/**
 * The play screen's markup for every state. Server-rendering pins the four
 * states, the option rows, the countdown and the result figures without a
 * DOM; the data half is a fetch around the same view.
 */

const question: FiveQuestion = {
  index: 2,
  total: 10,
  prompt: "Which memory loses its contents when power is cut?",
  options: ["RAM", "ROM", "SSD", "HDD"],
  limitMs: 10_000,
};

const result: FiveResult = {
  correct: 8,
  total: 10,
  score: 1_140,
  points: 1_254,
  streak: 3,
  rank: 12,
  players: 84,
  section: { label: "4 CSE A", rank: 2, total: 9 },
};

const render = (
  view: PlayView,
  extra: Partial<PlayRunViewProps> = {},
): string =>
  renderToStaticMarkup(React.createElement(PlayRunView, { view, ...extra }));

describe("PlayRunView", () => {
  it("draws the current question with its clock and pick rows", () => {
    const html = render({
      kind: "playing",
      attemptId: 41,
      score: 300,
      question,
      remainingMs: 8_000,
      feedback: null,
    });

    expect(html).toContain("Question 3 of 10");
    expect(html).toContain(
      "Which memory loses its contents when power is cut?",
    );
    expect(html).toContain("8s");
    expect(html).toContain("Score 300");
    expect(html).toContain("width:80%");
    // four options, lettered, each a real button
    for (const letter of ["A", "B", "C", "D"]) {
      expect(html).toContain(`>${letter}<`);
    }
    expect(html.match(/<button/g)).toHaveLength(4);
    for (const option of question.options) expect(html).toContain(option);
  });

  it("stops the clock at zero without hiding the picks", () => {
    const html = render({
      kind: "playing",
      attemptId: 41,
      score: 0,
      question,
      remainingMs: 0,
      feedback: null,
    });

    expect(html).toContain("Time&#x27;s up");
    expect(html).toContain("width:0%");
    expect(html.match(/<button/g)).toHaveLength(4);
  });

  it("reports how the last answer landed without moving the question", () => {
    const correct = render({
      kind: "playing",
      attemptId: 41,
      score: 450,
      question,
      remainingMs: 9_000,
      feedback: { correct: true, timedOut: false, earned: 150 },
    });
    expect(correct).toContain("Correct +150");
    expect(correct).toContain("run-feedback--correct");

    const missed = render({
      kind: "playing",
      attemptId: 41,
      score: 450,
      question,
      remainingMs: 9_000,
      feedback: { correct: false, timedOut: false, earned: 0 },
    });
    expect(missed).toContain("Missed");

    const late = render({
      kind: "playing",
      attemptId: 41,
      score: 450,
      question,
      remainingMs: 9_000,
      feedback: { correct: false, timedOut: true, earned: 0 },
    });
    expect(late).toContain("Too slow");
    expect(late).toContain("run-feedback--timeout");
  });

  it("prints the result figures as one group", () => {
    const html = render({ kind: "done", result, alreadyPlayed: false });

    expect(html).toContain("Run done");
    expect(html).toContain("8 of 10 correct.");
    expect(html).toContain("Run score");
    expect(html).toContain("1,140");
    expect(html).toContain("Season points");
    expect(html).toContain("1,254");
    expect(html).toContain("#12 of 84");
    expect(html).toContain("3 correct in a row");
    expect(html).toContain("4 CSE A · #2 of 9");
    expect(html).toContain("See the board");
    expect(html).toContain("Home");
    expect(html).not.toContain("Played today");
  });

  it("says when today's run was already played", () => {
    const html = render({ kind: "done", result, alreadyPlayed: true });

    expect(html).toContain("Played today. Back tomorrow.");
  });

  it("has a first-place word for a one-player day", () => {
    const html = render({
      kind: "done",
      result: { ...result, rank: 1, players: 1, streak: 1, section: null },
      alreadyPlayed: false,
    });

    expect(html).toContain("First");
    expect(html).not.toContain("1 correct in a row");
    expect(html).toContain("No section on record.");
  });

  it("asks for a roll before it asks for answers", () => {
    const html = render({ kind: "needs-roll" });

    expect(html).toContain("Save your roll to play");
    expect(html).toContain("Open profile");
    expect(html).not.toContain(">A<");
  });

  it("keeps a way out of every dead end", () => {
    const notReady = render({ kind: "not-ready" });
    expect(notReady).toContain("The set isn’t ready yet");
    expect(notReady).toContain("Try again");

    const error = render({ kind: "error" });
    expect(error).toContain("The run didn’t load");
    expect(error).toContain("Try again");

    const telegram = render({ kind: "needs-telegram" });
    expect(telegram).toContain("Open this inside Telegram");
  });

  it("shows a failed answer without losing the question", () => {
    const html = render(
      {
        kind: "playing",
        attemptId: 41,
        score: 300,
        question,
        remainingMs: 6_000,
        feedback: null,
      },
      { notice: "That answer didn't send. Try again." },
    );

    expect(html).toContain("That answer didn&#x27;t send. Try again.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Question 3 of 10");
  });

  it("shows a loading shape before the run answers", () => {
    const html = render({ kind: "loading" });

    expect(html).toContain("Today&#x27;s run");
    expect(html).toContain('aria-hidden="true"');
  });
});
