import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * The home banner's league read: the IST week plus the caller's run today.
 *
 * The route must stay cheap (it runs on every home visit) and private: the
 * week is public, "have I played" is not. These tests pin the four states the
 * banner renders, the cache split, and the invalid-signature refusal.
 */

const mocks = vi.hoisted(() => ({
  getFiveAttemptForDay: vi.fn(),
  getRegistration: vi.fn(),
}));

vi.mock("../../src/db/game.model.js", () => ({
  getFiveAttemptForDay: mocks.getFiveAttemptForDay,
}));

vi.mock("../../src/db/registration.model.js", () => ({
  getRegistration: mocks.getRegistration,
}));

const { gameLiveRouter } = await import("../../src/api/gameLive.js");
const { istStamp } = await import("../../src/games/time.js");
const { weekLabel } = await import("../../src/games/cards.js");

const createApp = () => {
  const app = express();
  app.use("/api", gameLiveRouter);
  return app;
};

const registration = {
  userId: "7",
  roll_no: "23KB1A0599",
  display_name: null,
  registered_at: "2026-11-01 10:00:00",
  updated_at: "2026-11-01 10:00:00",
};

/** Only the columns the live route reads; the model is mocked here. */
const attempt = (over: Record<string, unknown>) => ({
  status: "active",
  idx: 0,
  questionIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  points: 0,
  ...over,
});

beforeEach(() => {
  mocks.getFiveAttemptForDay.mockReset();
  mocks.getFiveAttemptForDay.mockResolvedValue(null);
  mocks.getRegistration.mockReset();
  mocks.getRegistration.mockResolvedValue(registration);
});

describe("GET /api/games/live", () => {
  it("answers an anonymous caller with the week and no personal line", async () => {
    const res = await request(createApp()).get("/api/games/live");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      weekLabel: weekLabel(istStamp().monday),
      me: null,
    });
    expect(res.headers["cache-control"]).toBe("public, max-age=30");
    expect(mocks.getFiveAttemptForDay).not.toHaveBeenCalled();
  });

  it("stops at the registration when no roll is saved", async () => {
    mocks.getRegistration.mockResolvedValue(null);

    const res = await request(createApp()).get("/api/games/live?userId=7");

    expect(res.body.me).toEqual({ registered: false, run: null });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(mocks.getFiveAttemptForDay).not.toHaveBeenCalled();
  });

  it("reads today as open when the account has not started a run", async () => {
    const res = await request(createApp()).get("/api/games/live?userId=7");

    expect(res.body.me).toEqual({
      registered: true,
      run: { state: "open", questions: 10 },
    });
    expect(mocks.getRegistration).toHaveBeenCalledWith("7");
    expect(mocks.getFiveAttemptForDay).toHaveBeenCalledWith(7, istStamp().date);
  });

  it("resumes at the question the run stopped on", async () => {
    mocks.getFiveAttemptForDay.mockResolvedValue(attempt({ idx: 3 }));

    const res = await request(createApp()).get("/api/games/live?userId=7");

    expect(res.body.me.run).toEqual({
      state: "playing",
      questions: 10,
      question: 4,
    });
  });

  it("clamps a finished-index attempt to the last question", async () => {
    mocks.getFiveAttemptForDay.mockResolvedValue(attempt({ idx: 12 }));

    const res = await request(createApp()).get("/api/games/live?userId=7");

    expect(res.body.me.run.question).toBe(10);
  });

  it("reports the finished run's season points, not its score", async () => {
    mocks.getFiveAttemptForDay.mockResolvedValue(
      attempt({ status: "done", idx: 10, points: 814 }),
    );

    const res = await request(createApp()).get("/api/games/live?userId=7");

    expect(res.body.me.run).toEqual({
      state: "done",
      questions: 10,
      points: 814,
    });
  });

  it("refuses a presented-but-invalid identity before reading anything", async () => {
    const res = await request(createApp())
      .get("/api/games/live")
      .set("X-Telegram-Init-Data", "auth_date=1&user=%7B%7D&hash=bad");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(mocks.getRegistration).not.toHaveBeenCalled();
  });

  it("answers a database failure without caching it", async () => {
    mocks.getRegistration.mockRejectedValue(new Error("db down"));

    const res = await request(createApp()).get("/api/games/live?userId=7");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: "Internal Server Error",
    });
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
