import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * The public league board behind the channel's full-leaderboard button.
 *
 * A verified student is named by their roll (masked when they hid the
 * leaderboard); an unverified player by their chosen name, Telegram name, or
 * @username. The page needs no identity, so the payload is cacheable.
 */

const mocks = vi.hoisted(() => ({
  getWeekPlayers: vi.fn(),
  getWeekPlayerCount: vi.fn(),
  getWeekSections: vi.fn(),
  getSectionTopPlayers: vi.fn(),
  getRollClaimStates: vi.fn(),
  getBotUserNames: vi.fn(),
}));

vi.mock("../../src/db/game.model.js", () => ({
  getWeekPlayers: mocks.getWeekPlayers,
  getWeekPlayerCount: mocks.getWeekPlayerCount,
  getWeekSections: mocks.getWeekSections,
  getSectionTopPlayers: mocks.getSectionTopPlayers,
}));

vi.mock("../../src/db/rollClaim.model.js", () => ({
  getRollClaimStates: mocks.getRollClaimStates,
}));

vi.mock("../../src/db/botUsers.model.js", () => ({
  getBotUserNames: mocks.getBotUserNames,
}));

const { gamesRouter } = await import("../../src/api/games.js");
const { istStamp } = await import("../../src/games/time.js");
const { weekLabel } = await import("../../src/games/cards.js");

const createApp = () => {
  const app = express();
  app.use("/api", gamesRouter);
  return app;
};

beforeEach(() => {
  mocks.getWeekPlayers.mockReset();
  mocks.getWeekPlayerCount.mockReset();
  mocks.getWeekPlayerCount.mockResolvedValue(2);
  mocks.getWeekSections.mockReset();
  mocks.getSectionTopPlayers.mockReset();
  mocks.getRollClaimStates.mockReset();
  mocks.getRollClaimStates.mockResolvedValue(
    new Map([
      ["23KB1A0599", { hidden: false }],
      ["23KB1A0700", { hidden: true }],
    ]),
  );
  mocks.getBotUserNames.mockReset();
  mocks.getBotUserNames.mockResolvedValue(
    new Map([
      [2, { firstName: "Ravi", username: "ravi_k" }],
      [4, { firstName: null, username: "ghost" }],
    ]),
  );
  mocks.getSectionTopPlayers.mockResolvedValue([
    {
      userId: 3,
      rollNo: "23KB1A0700",
      displayName: "Lakshmi",
      points: 1_240,
    },
    {
      userId: 4,
      rollNo: "23KB1A0701",
      displayName: null,
      points: 1_100,
    },
  ]);
  mocks.getWeekPlayers.mockResolvedValue([
    {
      userId: 1,
      rollNo: "23KB1A0599",
      displayName: "Asha",
      points: 2_100,
    },
    {
      userId: 2,
      rollNo: "23KB1A0600",
      displayName: null,
      points: 1_800,
    },
  ]);
  mocks.getWeekSections.mockResolvedValue([
    { key: "4|CSE|C", label: "4 CSE C", points: 4_820, players: 9 },
  ]);
});

describe("GET /api/games/board", () => {
  it("names verified rows by roll and unverified rows by identity", async () => {
    const res = await request(createApp()).get("/api/games/board");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      weekLabel: weekLabel(istStamp().monday),
      players: [
        // verified: the roll, even though a display name is saved
        { name: "23KB1A0599", points: 2_100 },
        // unverified: the Telegram first name
        { name: "Ravi", points: 1_800 },
      ],
      sections: [
        {
          label: "4 CSE C",
          points: 4_820,
          players: 9,
          // Only the number-one section carries its players.
          topPlayers: [
            // verified but hidden: the roll stays masked
            { name: "23KB1A0•••", points: 1_240 },
            // unverified with only a handle
            { name: "@ghost", points: 1_100 },
          ],
        },
      ],
    });
    expect(res.body).toMatchObject({
      playerTotal: 2,
      playerPage: 1,
      playerPageSize: 50,
      hasMorePlayers: false,
    });
    expect(res.headers["cache-control"]).toBe("public, max-age=30");
  });

  it("asks for the verification and Telegram identity of every row", async () => {
    await request(createApp()).get("/api/games/board");

    expect(mocks.getRollClaimStates).toHaveBeenCalledWith([
      "23KB1A0599",
      "23KB1A0600",
      "23KB1A0700",
      "23KB1A0701",
    ]);
    expect(mocks.getBotUserNames).toHaveBeenCalledWith([1, 2, 3, 4]);
  });

  it("asks for the first page of players and every scoring section", async () => {
    await request(createApp()).get("/api/games/board");

    const stamp = istStamp();
    expect(mocks.getWeekPlayers).toHaveBeenCalledWith("S1", stamp.week, 50, 0);
    expect(mocks.getWeekPlayerCount).toHaveBeenCalledWith("S1", stamp.week);
    expect(mocks.getWeekSections).toHaveBeenCalledWith("S1", stamp.week, 100);
    expect(mocks.getSectionTopPlayers).toHaveBeenCalledWith(
      "S1",
      stamp.week,
      "4|CSE|C",
      3,
    );
  });

  it("pages the player board instead of stopping at ten", async () => {
    mocks.getWeekPlayerCount.mockResolvedValue(120);

    const res = await request(createApp()).get(
      "/api/games/board?page=2&limit=25",
    );

    const stamp = istStamp();
    expect(mocks.getWeekPlayers).toHaveBeenCalledWith("S1", stamp.week, 25, 25);
    expect(res.body).toMatchObject({
      playerPage: 2,
      playerPageSize: 25,
      playerTotal: 120,
      hasMorePlayers: true,
    });
  });

  it("clamps an oversized page request", async () => {
    await request(createApp()).get("/api/games/board?limit=500");

    const stamp = istStamp();
    expect(mocks.getWeekPlayers).toHaveBeenCalledWith("S1", stamp.week, 100, 0);
  });

  it("only the leading section gets its top players", async () => {
    mocks.getWeekSections.mockResolvedValue([
      { key: "4|CSE|C", label: "4 CSE C", points: 4_820, players: 9 },
      { key: "3|ECE|A", label: "3 ECE A", points: 4_610, players: 8 },
    ]);

    const res = await request(createApp()).get("/api/games/board");

    expect(res.body.sections[0].topPlayers).toHaveLength(2);
    expect(res.body.sections[1]).not.toHaveProperty("topPlayers");
  });

  it("skips the leader query when no section has scored", async () => {
    mocks.getWeekSections.mockResolvedValue([]);

    const res = await request(createApp()).get("/api/games/board");

    expect(res.status).toBe(200);
    expect(res.body.sections).toEqual([]);
    expect(mocks.getSectionTopPlayers).not.toHaveBeenCalled();
  });

  it("refuses a presented-but-invalid identity", async () => {
    const res = await request(createApp())
      .get("/api/games/board")
      .set("X-Telegram-Init-Data", "auth_date=1&user=%7B%7D&hash=bad");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false });
    expect(mocks.getWeekPlayers).not.toHaveBeenCalled();
  });

  it("answers a database failure without caching it", async () => {
    mocks.getWeekPlayers.mockRejectedValue(new Error("db down"));

    const res = await request(createApp()).get("/api/games/board");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: "Internal Server Error",
    });
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
