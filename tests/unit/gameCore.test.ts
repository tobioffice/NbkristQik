import { describe, expect, it } from "vitest";
import {
  answerPoints,
  duelOutcome,
  fivePoints,
  formatDuration,
  maskRoll,
  nextStreak,
  publicName,
  sectionRefOf,
  streakMultiplier,
} from "../../src/games/scoring.js";
import {
  fastestCorrect,
  duelInviteCard,
  duelRecordCard,
  duelResultCard,
  fiveResultCard,
  leagueCard,
  morningPost,
  questionCard,
  resultsPost,
  weeklyPost,
} from "../../src/games/cards.js";
import { istStamp, isoWeekKey, previousDateKey } from "../../src/games/time.js";
import type {
  AttemptAnswer,
  GameAttempt,
  GameDuel,
  GameQuestion,
} from "../../src/games/types.js";

describe("the IST clock", () => {
  it("puts 03:00 UTC at 08:30 in India", () => {
    const stamp = istStamp(new Date("2026-11-15T03:00:00.000Z"));
    expect(stamp).toMatchObject({
      date: "2026-11-15",
      week: "2026-W46",
      monday: "2026-11-09",
      weekday: 7,
      hour: 8,
      minute: 30,
    });
  });

  it("rolls the date at IST midnight, not UTC midnight", () => {
    const stamp = istStamp(new Date("2026-11-15T18:31:00.000Z"));
    expect(stamp.date).toBe("2026-11-16");
    expect(stamp.weekday).toBe(1);
    expect(stamp.week).toBe("2026-W47");
  });

  it("knows ISO week boundaries", () => {
    expect(isoWeekKey("2026-11-15")).toBe("2026-W46");
    expect(isoWeekKey("2026-11-16")).toBe("2026-W47");
    expect(isoWeekKey("2025-12-29")).toBe("2026-W01");
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
  });

  it("walks back over a leap day", () => {
    expect(previousDateKey("2024-03-01")).toBe("2024-02-29");
    expect(previousDateKey("2026-03-01")).toBe("2026-02-28");
  });
});

describe("scoring", () => {
  it("pays inside ten seconds only, accuracy first", () => {
    expect(answerPoints(true, 0)).toBe(150);
    expect(answerPoints(true, 5_000)).toBe(125);
    expect(answerPoints(true, 10_000)).toBe(100);
    expect(answerPoints(true, 10_001)).toBe(0);
    expect(answerPoints(true, 60_000)).toBe(0);
    expect(answerPoints(false, 0)).toBe(0);
  });

  it("caps the streak bonus at 1.5x", () => {
    expect(streakMultiplier(1)).toBe(1);
    expect(streakMultiplier(2)).toBeCloseTo(1.1);
    expect(streakMultiplier(6)).toBeCloseTo(1.5);
    expect(streakMultiplier(30)).toBeCloseTo(1.5);
    expect(fivePoints(600, 2)).toBe(660);
  });

  it("resets a streak after a missed day", () => {
    expect(nextStreak(null, "2026-11-15", 0)).toBe(1);
    expect(nextStreak("2026-11-14", "2026-11-15", 3)).toBe(4);
    expect(nextStreak("2026-11-13", "2026-11-15", 3)).toBe(1);
    expect(nextStreak("2026-11-15", "2026-11-15", 3)).toBe(3);
  });

  it("splits duel points by the result", () => {
    expect(duelOutcome(700, 600)).toEqual({
      winner: "challenger",
      challengerPoints: 200,
      opponentPoints: 75,
    });
    expect(duelOutcome(600, 700)).toEqual({
      winner: "opponent",
      challengerPoints: 75,
      opponentPoints: 200,
    });
    expect(duelOutcome(650, 650)).toEqual({
      winner: "draw",
      challengerPoints: 125,
      opponentPoints: 125,
    });
  });

  it("builds a section from the portal's packed year", () => {
    expect(sectionRefOf({ year: "42", branch: "CSE", section: "C" })).toEqual({
      key: "4|CSE|C",
      label: "4 CSE C",
    });
    expect(sectionRefOf({ year: "31", branch: "ECE", section: "A" })).toEqual({
      key: "3|ECE|A",
      label: "3 ECE A",
    });
    // The portal stores the branch as a department code.
    expect(sectionRefOf({ year: "31", branch: "5", section: "G" })).toEqual({
      key: "3|CSE|G",
      label: "3 CSE G",
    });
    expect(sectionRefOf({ year: "", branch: "CSE", section: "C" })).toBeNull();
    expect(sectionRefOf({ year: "42", branch: "", section: "C" })).toBeNull();
    expect(sectionRefOf({ year: "11", branch: "2", section: "-" })).toBeNull();
  });

  it("never prints a full roll on a public board", () => {
    expect(maskRoll("23KB1A0599")).toBe("23KB1A0•••");
    expect(publicName(null, "23KB1A0599")).toBe("23KB1A0•••");
    expect(publicName("Asha", "23KB1A0599")).toBe("Asha");
    expect(publicName("  ", "23KB1A0599")).toBe("23KB1A0•••");
  });

  it("reads a duration", () => {
    expect(formatDuration(4_200)).toBe("4s");
    expect(formatDuration(64_000)).toBe("1m 04s");
    expect(formatDuration(0)).toBe("1s");
  });
});

const attempt: GameAttempt = {
  id: 7,
  game: "five",
  roundKey: "five-2026-11-15",
  dayKey: "2026-11-15",
  weekKey: "2026-W46",
  season: "S1",
  userId: 42,
  rollNo: "23KB1A0599",
  sectionKey: "4|CSE|C",
  sectionLabel: "4 CSE C",
  questionIds: [1, 2, 3, 4, 5],
  answers: [
    { option: 0, correct: true, ms: 1_000, points: 148 },
    { option: 1, correct: true, ms: 2_000, points: 145 },
    { option: 2, correct: false, ms: 3_000, points: 0 },
    { option: 3, correct: true, ms: 4_000, points: 140 },
    { option: 0, correct: true, ms: 5_000, points: 138 },
  ],
  idx: 5,
  score: 571,
  points: 628,
  streak: 2,
  duelId: null,
  status: "done",
  startedAt: "2026-11-15T03:00:00.000Z",
  shownAt: "2026-11-15T03:00:05.000Z",
  finishedAt: "2026-11-15T03:01:00.000Z",
};

const question: GameQuestion = {
  id: 1,
  prompt: "What does <CPU> stand for?",
  options: ["Central Processing Unit", "Other", "Third", "Fourth"],
  correct: 0,
  topic: "computing",
};

describe("the cards", () => {
  it("draws a question with one callback per option", () => {
    const card = questionCard({ attempt, question, index: 1 });
    expect(card.text).toContain("Question 2 of 5 · 10s");
    expect(card.text).toContain("&lt;CPU&gt;");
    expect(card.markup?.inline_keyboard).toHaveLength(4);
    expect(card.markup?.inline_keyboard[0][0].callback_data).toBe("q5_7_1_0");
  });

  it("shows the target in a duel question", () => {
    const card = questionCard({
      attempt: { ...attempt, game: "duel", score: 0 },
      question,
      index: 0,
      duelTarget: 612,
    });
    expect(card.text).toContain("Duel · Question 1 of 5 · 10s");
    expect(card.text).toContain("Target: <b>612</b>");
  });

  it("puts the result, streak and section on the Five card", () => {
    const card = fiveResultCard({
      attempt,
      rank: 7,
      total: 143,
      section: { label: "4 CSE C", rank: 5, total: 12 },
      alreadyPlayed: false,
    });

    expect(card.text).toContain("4 of 5 correct");
    expect(card.text).toContain("<b>571</b> run score");
    expect(card.text).toContain("<b>628</b> season points");
    expect(card.text).toContain("+57 streak");
    expect(card.text).toContain("#7 of 143 today");
    expect(card.text).toContain("2-day streak");
    expect(card.text).toContain("4 CSE C · <b>#5</b> of 12 this week");
    expect(card.rich).toContain("<table");
    expect(card.rich).toContain("Run score");
    expect(card.rich).toContain("Season points");
    expect(card.rich).toContain("4 CSE C");
    expect(card.markup?.inline_keyboard[0]).toHaveLength(2);
    expect(card.markup?.inline_keyboard[0][0].callback_data).toBe("duel_new_7");
    expect(card.markup?.inline_keyboard[0][1].callback_data).toBe(
      "league_show",
    );
  });

  it("marks a second visit as already played", () => {
    const card = fiveResultCard({
      attempt,
      rank: 1,
      total: 1,
      section: null,
      alreadyPlayed: true,
    });
    expect(card.text).toContain("First today");
    expect(card.text).toContain("Played today. Back tomorrow.");
    expect(card.text).toContain("No section on record");
    expect(card.text).not.toContain("1-day streak");
    expect(card.rich).toContain("Played today. Back tomorrow.");
  });

  const duel: GameDuel = {
    id: 12,
    challengerId: 42,
    challengerRoll: "23KB1A0599",
    challengerName: "Asha",
    challengerSectionKey: "4|CSE|C",
    challengerSectionLabel: "4 CSE C",
    challengerScore: 612,
    questionIds: [1, 2, 3, 4, 5],
    dayKey: "2026-11-15",
    weekKey: "2026-W46",
    season: "S1",
    status: "done",
    opponentId: 43,
    opponentRoll: "23KB1A0600",
    opponentName: null,
    opponentScore: 640,
    winnerId: 43,
    createdAt: "2026-11-15T03:00:00.000Z",
    finishedAt: "2026-11-15T04:00:00.000Z",
    expiresAt: "2026-11-17T03:00:00.000Z",
  };

  it("writes the duel result from both sides", () => {
    const challenger = duelResultCard({ duel, userId: 42 });
    const opponent = duelResultCard({ duel, userId: 43 });

    expect(challenger.text).toContain("You <b>612</b>");
    expect(challenger.text).toContain("23KB1A0••• <b>640</b>");
    expect(challenger.text).toContain("lost by 28");
    expect(opponent.text).toContain("You <b>640</b>");
    expect(opponent.text).toContain("Asha <b>612</b>");
    expect(opponent.text).toContain("You won by 28");
  });

  it("builds a share link that opens the duel", () => {
    const card = duelInviteCard({ duel });
    const share = card.markup?.inline_keyboard[0][0].url ?? "";
    expect(share).toContain("https://t.me/share/url");
    expect(decodeURIComponent(share)).toContain("duel_12");
    expect(card.markup?.inline_keyboard[0][1].copy_text?.text).toContain(
      "duel_12",
    );
  });

  it("keeps the weekly board public and the names masked", () => {
    const card = leagueCard({
      label: "Week of 10 Nov",
      sections: [
        { key: "4|CSE|C", label: "4 CSE C", points: 4_820, players: 9 },
      ],
      players: [
        {
          userId: 1,
          rollNo: "23KB1A0599",
          displayName: "<Asha>",
          points: 2_100,
        },
        {
          userId: 2,
          rollNo: "23KB1A0600",
          displayName: null,
          points: 1_800,
        },
      ],
      me: { points: 628, rank: 37, players: 143 },
      mySection: { label: "4 CSE C", rank: 1, total: 12 },
    });

    expect(card.text).toContain("Section Wars · Week of 10 Nov");
    expect(card.text).toContain("&lt;Asha&gt;");
    expect(card.text).toContain("23KB1A0•••");
    expect(card.text).toContain("You: <b>#37</b> of 143");
    expect(card.rich).toContain("<table");
    expect(card.rich).toContain("4 CSE C");
    expect(card.rich).toContain("Asha");
    expect(card.rich).toContain("23KB1A0•••");
  });

  it("keeps the channel posts on URL buttons only", () => {
    const morning = morningPost("15 Nov");
    expect(morning.markup?.inline_keyboard[0][0].url).toContain("five");

    const results = resultsPost({
      label: "15 Nov",
      top: [
        {
          userId: 1,
          rollNo: "23KB1A0599",
          displayName: null,
          points: 700,
        },
      ],
      played: 42,
      fastestMs: 4_200,
      section: { key: "4|CSE|C", label: "4 CSE C", points: 900, players: 3 },
    });
    expect(results.text).toContain("42 played");
    expect(results.text).toContain("23KB1A0•••");
    expect(results.text).toContain("Fastest answer: <b>4s</b>");
    expect(results.text).toContain("Section of the day: <b>4 CSE C</b>");
    for (const row of results.markup?.inline_keyboard ?? []) {
      for (const button of row) {
        expect(button.callback_data).toBeUndefined();
        expect(button.url).toBeTruthy();
      }
    }
  });

  it("finds the fastest correct answer", () => {
    const answers: AttemptAnswer[][] = [
      [
        { option: 0, correct: false, ms: 100, points: 0 },
        { option: 1, correct: true, ms: 4_200, points: 140 },
      ],
      [{ option: 2, correct: true, ms: 2_800, points: 143 }],
    ];
    expect(fastestCorrect(answers)).toBe(2_800);
    expect(fastestCorrect([[]])).toBeNull();
  });
});

describe("the empty and edge cards", () => {
  it("says first instead of one of one", () => {
    const card = fiveResultCard({
      attempt: { ...attempt, points: attempt.score, streak: 1 },
      rank: 1,
      total: 1,
      section: { label: "4 CSE C", rank: 1, total: 1 },
      alreadyPlayed: false,
    });

    expect(card.text).toContain("571</b> points");
    expect(card.text).toContain("First today");
    expect(card.text).toContain("4 CSE C · first this week");
    expect(card.text).not.toContain("streak");
    expect(card.rich).toContain("first this week");
  });

  it("shows the empty weekly board", () => {
    const card = leagueCard({
      label: "Week of 10 Nov",
      sections: [],
      players: [],
      me: { points: 0, rank: null, players: 0 },
      mySection: null,
    });

    expect(card.text).toContain("No one has played this week");
    expect(card.rich).toContain("No one has played this week");
    expect(card.text).not.toContain("You haven't scored");
  });

  it("writes a draw in the duel result", () => {
    const draw: GameDuel = {
      id: 12,
      challengerId: 42,
      challengerRoll: "23KB1A0599",
      challengerName: "Asha",
      challengerSectionKey: "4|CSE|C",
      challengerSectionLabel: "4 CSE C",
      challengerScore: 600,
      questionIds: [1, 2, 3, 4, 5],
      dayKey: "2026-11-15",
      weekKey: "2026-W46",
      season: "S1",
      status: "done",
      opponentId: 43,
      opponentRoll: "23KB1A0600",
      opponentName: null,
      opponentScore: 600,
      winnerId: null,
      createdAt: "2026-11-15T03:00:00.000Z",
      finishedAt: "2026-11-15T04:00:00.000Z",
      expiresAt: "2026-11-17T03:00:00.000Z",
    };

    const card = duelResultCard({ duel: draw, userId: 42 });

    expect(card.text).toContain("It's a draw.");
    expect(card.rich).toContain("It's a draw.");
  });

  it("offers a run when there is no duel attempt", () => {
    const card = duelRecordCard({
      record: { wins: 0, losses: 0, draws: 0 },
      attemptId: null,
    });

    expect(card.text).toContain("Finish today's five first");
    expect(card.markup?.inline_keyboard).toHaveLength(1);
  });

  it("skips the fastest and section lines when they are missing", () => {
    const card = resultsPost({
      label: "15 Nov",
      top: [],
      played: 0,
      fastestMs: null,
      section: null,
    });

    expect(card.text).toContain("0 played");
    expect(card.text).not.toContain("Fastest answer");
    expect(card.text).not.toContain("Section of the day");
  });

  it("writes the weekly board with no champion", () => {
    const card = weeklyPost({
      label: "Week of 10 Nov",
      sections: [
        { key: "4|CSE|C", label: "4 CSE C", points: 4_820, players: 9 },
      ],
      players: [],
    });

    expect(card.text).toContain("4 CSE C");
    expect(card.text).not.toContain("Player of the week");
  });
});
