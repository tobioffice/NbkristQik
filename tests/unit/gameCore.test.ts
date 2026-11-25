import { describe, expect, it } from "vitest";
import {
  answerPoints,
  boardName,
  duelOutcome,
  fivePoints,
  formatDuration,
  maskRoll,
  longestCorrectStreak,
  publicName,
  sectionRefOf,
  streakMultiplier,
} from "../../src/games/scoring.js";
import {
  duelInviteCard,
  duelRecordCard,
  duelResultCard,
  fiveResultCard,
  leagueCard,
  liveBoardCard,
  questionCard,
} from "../../src/games/cards.js";
import {
  istClockLabel,
  istStamp,
  isoWeekKey,
  previousDateKey,
} from "../../src/games/time.js";
import type {
  GameAttempt,
  GameDuel,
  GameQuestion,
} from "../../src/games/types.js";

describe("the IST clock", () => {
  it("writes the board's clock in the 12-hour form", () => {
    expect(istClockLabel(new Date("2026-11-15T03:00:00.000Z"))).toBe("8:30 am");
    expect(istClockLabel(new Date("2026-11-15T10:45:00.000Z"))).toBe("4:15 pm");
    expect(istClockLabel(new Date("2026-11-15T18:31:00.000Z"))).toBe(
      "12:01 am",
    );
  });

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

  it("caps the run-of-correct bonus at 1.5x", () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(1)).toBe(1);
    expect(streakMultiplier(2)).toBeCloseTo(1.1);
    expect(streakMultiplier(6)).toBeCloseTo(1.5);
    expect(streakMultiplier(10)).toBeCloseTo(1.5);
    expect(fivePoints(600, 0)).toBe(600);
    expect(fivePoints(600, 2)).toBe(660);
  });

  it("counts the longest run of correct answers in a run", () => {
    const answers = (...correct: boolean[]) =>
      correct.map((value) => ({
        option: 0,
        correct: value,
        ms: 1000,
        points: value ? 100 : 0,
      }));

    expect(longestCorrectStreak(answers())).toBe(0);
    expect(longestCorrectStreak(answers(true, true, true))).toBe(3);
    expect(
      longestCorrectStreak(answers(true, false, true, true, true, true)),
    ).toBe(4);
    expect(longestCorrectStreak(answers(false, true, false, true))).toBe(1);
    expect(
      longestCorrectStreak(answers(true, true, true, true, true, true)),
    ).toBe(6);
  });

  it("names the duel winner without paying a run's points", () => {
    expect(duelOutcome(700, 600)).toEqual({ winner: "challenger" });
    expect(duelOutcome(600, 700)).toEqual({ winner: "opponent" });
    expect(duelOutcome(650, 650)).toEqual({ winner: "draw" });
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

  it("names a board row by verified roll, else by the Telegram identity", () => {
    expect(maskRoll("23KB1A0599")).toBe("23KB1A0•••");

    // verified: the roll, whatever display name they saved
    expect(
      boardName({ displayName: "Asha", rollNo: "23kb1a0599", verified: true }),
    ).toBe("23KB1A0599");
    // verified and hidden: the roll stays masked
    expect(
      boardName({
        displayName: "Asha",
        rollNo: "23KB1A0599",
        verified: true,
        hidden: true,
      }),
    ).toBe("23KB1A0•••");

    // unverified: chosen display name, then Telegram name, then @username
    expect(boardName({ displayName: "Asha", rollNo: "23KB1A0599" })).toBe(
      "Asha",
    );
    expect(
      boardName({
        displayName: null,
        rollNo: "23KB1A0599",
        firstName: "Ravi",
      }),
    ).toBe("Ravi");
    expect(
      boardName({
        displayName: null,
        rollNo: "23KB1A0599",
        firstName: null,
        username: "ravi_k",
      }),
    ).toBe("@ravi_k");
    // nothing to name them with: the masked roll is the last resort
    expect(boardName({ displayName: null, rollNo: "23KB1A0599" })).toBe(
      "23KB1A0•••",
    );

    // the duel card keeps the old masking rule
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
  questionIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  answers: [
    { option: 0, correct: true, ms: 1_000, points: 148 },
    { option: 1, correct: true, ms: 2_000, points: 145 },
    { option: 2, correct: false, ms: 3_000, points: 0 },
    { option: 3, correct: true, ms: 4_000, points: 140 },
    { option: 0, correct: true, ms: 5_000, points: 138 },
    { option: 1, correct: true, ms: 6_000, points: 136 },
    { option: 2, correct: true, ms: 7_000, points: 134 },
    { option: 3, correct: false, ms: 8_000, points: 0 },
    { option: 0, correct: true, ms: 9_000, points: 132 },
    { option: 1, correct: false, ms: 10_000, points: 0 },
  ],
  idx: 10,
  score: 900,
  points: 990,
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
    expect(card.text).toContain("Question 2 of 10 · 10s");
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
    expect(card.text).toContain("Duel · Question 1 of 10 · 10s");
    expect(card.text).toContain("Target: <b>612</b>");
  });

  it("puts the result, streak and section on the run card", () => {
    const card = fiveResultCard({
      attempt,
      rank: 7,
      total: 143,
      section: { label: "4 CSE C", rank: 5, total: 12 },
      alreadyPlayed: false,
    });

    expect(card.text).toContain("7 of 10 correct");
    expect(card.text).toContain("<b>900</b> run score");
    expect(card.text).toContain("<b>990</b> season points");
    expect(card.text).toContain("+90 streak bonus");
    expect(card.text).toContain("#7 of 143 today");
    expect(card.text).toContain("2 correct in a row");
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
    expect(card.text).not.toContain("1 correct in a row");
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
    questionIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
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
          plays: 5,
        },
        {
          userId: 2,
          rollNo: "23KB1A0600",
          displayName: null,
          points: 1_800,
          plays: 3,
        },
      ],
      me: { points: 628, rank: 37, players: 143 },
      mySection: { label: "4 CSE C", rank: 1, total: 12 },
    });

    expect(card.text).toContain("Section Wars · Week of 10 Nov");
    expect(card.text).toContain("&lt;Asha&gt;");
    expect(card.text).toContain("23KB1A0•••");
    expect(card.text).toContain("2,100 · 5 runs");
    expect(card.text).toContain("You: <b>#37</b> of 143");
    expect(card.rich).toContain("<table");
    expect(card.rich).toContain("4 CSE C");
    expect(card.rich).toContain("Asha");
    expect(card.rich).toContain("23KB1A0•••");
    expect(card.rich).toContain('<th align="right">Runs</th>');
    expect(card.rich).toContain('<td align="right">5 runs</td>');
  });

  it("renders today, the week's students and the sections", () => {
    const card = liveBoardCard({
      label: "Week of 10 Nov",
      dayLabel: "10 Nov",
      dayPlayers: [
        {
          userId: 9,
          rollNo: "23KB1A0999",
          displayName: "Ravi",
          points: 512,
          plays: 1,
        },
      ],
      players: [
        {
          userId: 1,
          rollNo: "23KB1A0599",
          displayName: "<Asha>",
          points: 2_100,
          plays: 4,
        },
        {
          userId: 2,
          rollNo: "23KB1A0600",
          displayName: null,
          points: 1_800,
          plays: 2,
        },
      ],
      sections: [
        { key: "4|CSE|C", label: "4 CSE C", points: 4_820, players: 9 },
      ],
      updatedAt: "4:12 pm",
    });

    expect(card.rich).toContain("<b>League board · Week of 10 Nov</b>");
    expect(card.rich).toContain("<b>Today · 10 Nov</b>");
    expect(card.rich).toContain("<b>This week</b>");
    expect(card.rich).toContain("<b>Section Wars</b>");
    expect(card.rich).toContain('<th align="left">Player</th>');
    expect(card.rich).toContain('<th align="right">Runs</th>');
    expect(card.rich).toContain('<th align="left">Section</th>');
    expect(card.rich).toContain("Ravi");
    expect(card.rich).toContain("<b>512</b>");
    expect(card.rich).toContain("&lt;Asha&gt;");
    expect(card.rich).toContain("23KB1A0•••");
    expect(card.rich).toContain("<b>2,100</b>");
    expect(card.rich).toContain("4 runs");
    expect(card.rich).toContain("<b>4,820</b>");
    expect(card.rich).toContain("Updated 4:12 pm IST");
    expect(card.text).toContain("<b>Today · 10 Nov</b>");
    expect(card.text).toContain("1. Ravi — <b>512</b>");
    expect(card.text).toContain("<b>This week</b>");
    expect(card.text).toContain("<b>Section Wars</b>");
    expect(card.text).toContain("23KB1A0•••");
    expect(card.text).toContain("<b>2,100</b> · 4 runs");
  });

  it("names verified rows by roll and unverified rows by identity", () => {
    const card = liveBoardCard({
      label: "Week of 10 Nov",
      dayLabel: "10 Nov",
      dayPlayers: [],
      players: [
        {
          userId: 1,
          rollNo: "23KB1A0599",
          displayName: "Asha",
          verified: true,
          points: 200,
          plays: 3,
        },
        {
          userId: 2,
          rollNo: "23KB1A0600",
          displayName: null,
          firstName: "Ravi",
          points: 100,
          plays: 2,
        },
        {
          userId: 3,
          rollNo: "23KB1A0700",
          displayName: null,
          verified: true,
          hidden: true,
          points: 50,
          plays: 1,
        },
      ],
      sections: [],
      updatedAt: "4:12 pm",
    });

    expect(card.rich).toContain("23KB1A0599");
    expect(card.rich).toContain("Ravi");
    expect(card.rich).toContain("23KB1A0•••");
    expect(card.rich).not.toContain("Asha");
    expect(card.rich).not.toContain("23KB1A0700");
  });

  it("shows only the top three rows of each table", () => {
    const card = liveBoardCard({
      label: "Week of 10 Nov",
      dayLabel: "10 Nov",
      dayPlayers: [1, 2, 3, 4, 5].map((index) => ({
        userId: 100 + index,
        rollNo: `23KB1A09${index}0`,
        displayName: `Today ${index}`,
        points: 900 - index * 100,
        plays: 1,
      })),
      players: [1, 2, 3, 4, 5].map((index) => ({
        userId: index,
        rollNo: `23KB1A05${index}0`,
        displayName: `Player ${index}`,
        points: 3_000 - index * 100,
        plays: 3,
      })),
      sections: [1, 2, 3, 4, 5].map((index) => ({
        key: `4|CSE|${index}`,
        label: `Section ${index}`,
        points: 5_000 - index * 100,
        players: 10,
      })),
      updatedAt: "4:12 pm",
    });

    expect(card.rich).toContain("Today 3");
    expect(card.rich).not.toContain("Today 4");
    expect(card.rich).toContain("Player 3");
    expect(card.rich).not.toContain("Player 4");
    expect(card.rich).toContain("Section 3");
    expect(card.rich).not.toContain("Section 4");
    expect(card.text).toContain("Today 3");
    expect(card.text).not.toContain("Today 4");
    expect(card.text).toContain("Player 3");
    expect(card.text).not.toContain("Player 4");
  });

  it("writes the empty live board as one line", () => {
    const card = liveBoardCard({
      label: "Week of 10 Nov",
      dayLabel: "10 Nov",
      dayPlayers: [],
      players: [],
      sections: [],
      updatedAt: "4:12 pm",
    });

    expect(card.rich).toContain(
      "No one has played yet today or this week. Be the first.",
    );
    expect(card.rich).not.toContain("<table");
    expect(card.text).toContain(
      "No one has played yet today or this week. Be the first.",
    );
  });

  it("keeps the live board on URL buttons only", () => {
    const card = liveBoardCard({
      label: "Week of 10 Nov",
      dayLabel: "10 Nov",
      dayPlayers: [],
      players: [],
      sections: [],
      updatedAt: "4:12 pm",
    });

    for (const row of card.markup?.inline_keyboard ?? []) {
      for (const button of row) {
        expect(button.callback_data).toBeUndefined();
        expect(button.url).toBeTruthy();
      }
    }
    expect(card.markup?.inline_keyboard[0][0].url).toContain("quiz");

    const urls = (card.markup?.inline_keyboard.flat() ?? []).map(
      (button) => button.url ?? "",
    );
    expect(urls.some((url) => url.includes("startapp=games"))).toBe(true);
    expect(urls.some((url) => url.includes("startapp=verify"))).toBe(true);
  });

  it("says when one side of the board has no rows yet", () => {
    const card = liveBoardCard({
      label: "Week of 10 Nov",
      dayLabel: "10 Nov",
      dayPlayers: [],
      players: [
        {
          userId: 1,
          rollNo: "23KB1A0599",
          displayName: "Asha",
          points: 2_100,
          plays: 4,
        },
      ],
      sections: [],
      updatedAt: "4:12 pm",
    });

    expect(card.rich).toContain("<b>This week</b>");
    expect(card.rich).toContain("No one has played today yet. Be the first.");
    expect(card.rich).toContain("No section has scored this week yet.");
    expect(card.text).toContain("No one has played today yet. Be the first.");
    expect(card.text).toContain("No section has scored this week yet.");
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

    expect(card.text).toContain("900</b> points");
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

    expect(card.text).toContain("Finish today's run first");
    expect(card.markup?.inline_keyboard).toHaveLength(1);
  });
});
