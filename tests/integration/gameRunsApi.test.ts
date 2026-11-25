import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * The runs page's read: the caller's own finished daily runs, every question
 * with the answer given, never another account's or a duel's.
 */

const mocks = vi.hoisted(() => ({
  listAttemptsForUser: vi.fn(),
  getQuestionsByIds: vi.fn(),
}));

vi.mock("../../src/db/game.model.js", () => ({
  listAttemptsForUser: mocks.listAttemptsForUser,
  getQuestionsByIds: mocks.getQuestionsByIds,
}));

const { gameRunsRouter } = await import("../../src/api/gameRuns.js");

const createApp = () => {
  const app = express();
  app.use("/api", gameRunsRouter);
  return app;
};

const attempt = (over: Record<string, unknown> = {}) => ({
  id: 7,
  game: "five",
  status: "done",
  roundKey: "five-2026-11-25",
  dayKey: "2026-11-25",
  weekKey: "2026-W48",
  season: "S1",
  userId: 7,
  rollNo: "23KB1A0599",
  sectionKey: "4|CSE|C",
  sectionLabel: "4 CSE C",
  questionIds: [1, 2],
  answers: [
    { option: 0, correct: true, ms: 4000, points: 150 },
    { option: 2, correct: false, ms: 12000, points: 0 },
  ],
  idx: 2,
  score: 1000,
  points: 1100,
  streak: 4,
  duelId: null as number | null,
  startedAt: "2026-11-25T10:00:00.000Z",
  shownAt: null as string | null,
  finishedAt: "2026-11-25T10:10:00.000Z",
  ...over,
});

beforeEach(() => {
  mocks.listAttemptsForUser.mockReset();
  mocks.listAttemptsForUser.mockResolvedValue([attempt()]);
  mocks.getQuestionsByIds.mockReset();
  mocks.getQuestionsByIds.mockResolvedValue([
    {
      id: 1,
      prompt: "Which one is correct?",
      options: ["Right", "Wrong", "Also wrong", "Still wrong"],
      correct: 0,
      topic: "test",
    },
    {
      id: 2,
      prompt: "Which one is wrong?",
      options: ["Right", "Wrong", "Also wrong", "Still wrong"],
      correct: 1,
      topic: "test",
    },
  ]);
});

describe("GET /api/games/runs", () => {
  it("refuses an anonymous caller", async () => {
    const res = await request(createApp()).get("/api/games/runs");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("returns only the caller's finished daily runs", async () => {
    mocks.listAttemptsForUser.mockResolvedValue([
      attempt(),
      // not runs: a duel and an unfinished attempt
      attempt({
        id: 8,
        game: "duel",
        duelId: 3,
        roundKey: "d3",
      }),
      attempt({ id: 9, status: "active", finishedAt: null }),
    ]);

    const res = await request(createApp()).get("/api/games/runs?userId=7");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.body.success).toBe(true);
    expect(res.body.runs).toHaveLength(1);
    expect(mocks.listAttemptsForUser).toHaveBeenCalledWith(7, 60);

    const run = res.body.runs[0];
    expect(run).toMatchObject({
      id: 7,
      dayKey: "2026-11-25",
      score: 1000,
      points: 1100,
      correct: 1,
      total: 2,
      streak: 1,
      durationMs: 600_000,
    });
    expect(run.questions[0]).toMatchObject({
      index: 1,
      prompt: "Which one is correct?",
      correctIndex: 0,
      chosenIndex: 0,
      correct: true,
      ms: 4000,
      points: 150,
    });
    expect(run.questions[1]).toMatchObject({
      index: 2,
      correctIndex: 1,
      chosenIndex: 2,
      correct: false,
      ms: 12000,
      points: 0,
    });
  });

  it("answers an empty history without a query error", async () => {
    mocks.listAttemptsForUser.mockResolvedValue([]);

    const res = await request(createApp()).get("/api/games/runs?userId=7");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, runs: [] });
    expect(mocks.getQuestionsByIds).toHaveBeenCalledWith([]);
  });
});
