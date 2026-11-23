import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * The daily run inside the Mini App.
 *
 * These pin the four start answers (play, resume, finished, no roll) and the
 * answer path (next question or result), plus the two rules that matter most:
 * the correct option never appears in a payload, and an answer for a question
 * the browser is no longer on is refused instead of landing on the next one.
 */

const mocks = vi.hoisted(() => ({
  startFiveRun: vi.fn(),
  finishFiveRun: vi.fn(),
  fiveQuestionView: vi.fn(),
  fiveResultView: vi.fn(),
  getAttempt: vi.fn(),
  touchShownAt: vi.fn(),
  recordAnswer: vi.fn(),
  trackActivity: vi.fn(),
}));

vi.mock("../../src/games/five.js", () => ({
  startFiveRun: mocks.startFiveRun,
  finishFiveRun: mocks.finishFiveRun,
  fiveQuestionView: mocks.fiveQuestionView,
  fiveResultView: mocks.fiveResultView,
}));

vi.mock("../../src/db/game.model.js", () => ({
  getAttempt: mocks.getAttempt,
  touchShownAt: mocks.touchShownAt,
}));

vi.mock("../../src/games/play.js", () => ({
  recordAnswer: mocks.recordAnswer,
}));

vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: mocks.trackActivity,
}));

const { gamesPlayRouter } = await import("../../src/api/gamesPlay.js");

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api", gamesPlayRouter);
  return app;
};

const attempt = (over: Record<string, unknown> = {}) => ({
  id: 41,
  game: "five",
  roundKey: "five-2026-11-23",
  dayKey: "2026-11-23",
  weekKey: "2026-W47",
  season: "S1",
  userId: 7,
  rollNo: "23KB1A0599",
  sectionKey: "4|CSE|A",
  sectionLabel: "4 CSE A",
  questionIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  answers: [],
  idx: 2,
  score: 150,
  points: 0,
  streak: 0,
  duelId: null,
  status: "active",
  startedAt: "2026-11-23 10:00:00",
  shownAt: "2026-11-23 10:01:00",
  finishedAt: null,
  ...over,
});

const questionView = {
  index: 2,
  total: 10,
  prompt: "Which memory is volatile?",
  options: ["RAM", "ROM", "SSD", "HDD"],
};

const resultView = {
  correct: 8,
  total: 10,
  score: 1_140,
  points: 1_254,
  streak: 3,
  rank: 12,
  players: 84,
  section: { label: "4 CSE A", rank: 2, total: 9 },
};

const postStart = (app: express.Express, body: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/games/five/start")
    .send({ userId: "7", ...body });

const postAnswer = (app: express.Express, body: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/games/five/answer")
    .send({ userId: "7", attemptId: 41, index: 2, option: 1, ...body });

beforeEach(() => {
  mocks.startFiveRun.mockReset();
  mocks.startFiveRun.mockResolvedValue({
    state: "playing",
    attempt: attempt(),
    created: true,
  });
  mocks.finishFiveRun.mockReset();
  mocks.finishFiveRun.mockResolvedValue({
    attempt: attempt({ status: "done", idx: 10, points: 1_254 }),
    finished: true,
  });
  mocks.fiveQuestionView.mockReset();
  mocks.fiveQuestionView.mockResolvedValue(questionView);
  mocks.fiveResultView.mockReset();
  mocks.fiveResultView.mockResolvedValue(resultView);
  mocks.getAttempt.mockReset();
  mocks.getAttempt.mockResolvedValue(attempt());
  mocks.touchShownAt.mockReset();
  mocks.touchShownAt.mockResolvedValue(undefined);
  mocks.recordAnswer.mockReset();
  mocks.recordAnswer.mockResolvedValue({
    attempt: attempt({ idx: 3, score: 300, answers: [] }),
    correct: true,
    timedOut: false,
    earned: 150,
    done: false,
  });
  mocks.trackActivity.mockReset();
});

describe("POST /api/games/five/start", () => {
  it("hands back the current question and starts its clock", async () => {
    const res = await postStart(createApp());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      state: "playing",
      attemptId: 41,
      score: 150,
      question: {
        index: 2,
        total: 10,
        prompt: "Which memory is volatile?",
        options: ["RAM", "ROM", "SSD", "HDD"],
        limitMs: 10_000,
      },
    });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(mocks.touchShownAt).toHaveBeenCalledWith(41, expect.any(String));
    expect(mocks.trackActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "game:five_start" }),
    );
  });

  it("never puts the correct option in the payload", async () => {
    const res = await postStart(createApp());

    expect(JSON.stringify(res.body)).not.toContain("correct");
  });

  it("counts a resume separately from a new run", async () => {
    mocks.startFiveRun.mockResolvedValue({
      state: "playing",
      attempt: attempt(),
      created: false,
    });

    await postStart(createApp());

    expect(mocks.trackActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "game:five_resume" }),
    );
  });

  it("asks for a roll before a run", async () => {
    mocks.startFiveRun.mockResolvedValue({ state: "needs-roll" });

    const res = await postStart(createApp());

    expect(res.body).toEqual({ success: true, state: "needs-roll" });
    expect(mocks.touchShownAt).not.toHaveBeenCalled();
  });

  it("says when the day's set is not ready", async () => {
    mocks.startFiveRun.mockResolvedValue({ state: "not-ready" });

    const res = await postStart(createApp());

    expect(res.body).toEqual({ success: true, state: "not-ready" });
  });

  it("shows the finished run to a student who already played", async () => {
    mocks.startFiveRun.mockResolvedValue({
      state: "done",
      attempt: attempt({ status: "done", idx: 10, points: 1_254 }),
    });

    const res = await postStart(createApp());

    expect(res.body).toMatchObject({
      success: true,
      state: "done",
      alreadyPlayed: true,
      result: resultView,
    });
  });

  it("refuses a caller with no identity", async () => {
    const res = await request(createApp())
      .post("/api/games/five/start")
      .send({});

    expect(res.status).toBe(401);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(mocks.startFiveRun).not.toHaveBeenCalled();
  });

  it("answers a database failure without caching it", async () => {
    mocks.startFiveRun.mockRejectedValue(new Error("db down"));

    const res = await postStart(createApp());

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: "Internal Server Error",
    });
  });
});

describe("POST /api/games/five/answer", () => {
  it("records the pick and returns the next question", async () => {
    const res = await postAnswer(createApp());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      state: "playing",
      attemptId: 41,
      score: 300,
      question: { index: 2, total: 10 },
      feedback: { correct: true, timedOut: false, earned: 150 },
    });
    expect(mocks.recordAnswer).toHaveBeenCalledWith({
      attempt: expect.objectContaining({ id: 41 }),
      index: 2,
      option: 1,
    });
    expect(mocks.touchShownAt).toHaveBeenCalled();
  });

  it("refuses an answer for a question that already moved on", async () => {
    mocks.recordAnswer.mockResolvedValue("stale");

    const res = await postAnswer(createApp());

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, state: "stale" });
  });

  it("refuses another account's attempt", async () => {
    mocks.getAttempt.mockResolvedValue(attempt({ userId: 8 }));

    const res = await postAnswer(createApp());

    expect(res.status).toBe(404);
    expect(mocks.recordAnswer).not.toHaveBeenCalled();
  });

  it("refuses an attempt that is not the daily run", async () => {
    mocks.getAttempt.mockResolvedValue(attempt({ game: "duel" }));

    const res = await postAnswer(createApp());

    expect(res.status).toBe(404);
  });

  it("rejects a malformed option instead of scoring it", async () => {
    const res = await postAnswer(createApp(), { option: 99 });

    expect(res.status).toBe(400);
    expect(mocks.recordAnswer).not.toHaveBeenCalled();
  });

  it("finishes the run on the last answer", async () => {
    mocks.recordAnswer.mockResolvedValue({
      attempt: attempt({ idx: 10, score: 1_140, answers: [] }),
      correct: true,
      timedOut: false,
      earned: 150,
      done: true,
    });

    const res = await postAnswer(createApp(), { index: 9, option: 0 });

    expect(res.body).toMatchObject({
      success: true,
      state: "done",
      alreadyPlayed: false,
      result: resultView,
    });
    expect(mocks.finishFiveRun).toHaveBeenCalled();
    expect(mocks.trackActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "game:five_finish" }),
    );
  });

  it("answers a duplicate tap after the finish with the result", async () => {
    mocks.getAttempt.mockResolvedValue(
      attempt({ status: "done", idx: 10, points: 1_254 }),
    );

    const res = await postAnswer(createApp());

    expect(res.body).toMatchObject({
      success: true,
      state: "done",
      alreadyPlayed: true,
      result: resultView,
    });
    expect(mocks.recordAnswer).not.toHaveBeenCalled();
  });
});
