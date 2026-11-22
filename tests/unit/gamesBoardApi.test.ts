import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * The public league board behind the channel's full-leaderboard button.
 *
 * The rows are the channel's public names: a chosen display name, or the roll
 * with its last three characters masked. The page needs no identity, so the
 * payload is cacheable for a few seconds.
 */

const mocks = vi.hoisted(() => ({
  getWeekPlayers: vi.fn(),
  getWeekPlayerCount: vi.fn(),
  getWeekSections: vi.fn(),
  getSectionTopPlayers: vi.fn(),
  getHiddenRolls: vi.fn(),
}));

vi.mock("../../src/db/game.model.js", () => ({
  getWeekPlayers: mocks.getWeekPlayers,
  getWeekPlayerCount: mocks.getWeekPlayerCount,
  getWeekSections: mocks.getWeekSections,
  getSectionTopPlayers: mocks.getSectionTopPlayers,
}));

vi.mock("../../src/db/rollClaim.model.js", () => ({
  getHiddenRolls: mocks.getHiddenRolls,
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
  mocks.getHiddenRolls.mockReset();
  mocks.getHiddenRolls.mockResolvedValue(new Set());
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
  it("returns the chosen name with the full roll", async () => {
    const res = await request(createApp()).get("/api/games/board");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      weekLabel: weekLabel(istStamp().monday),
      players: [
        { name: "Asha", roll: "23KB1A0599", points: 2_100 },
        // no display name: the roll is the name
        { name: "23KB1A0600", roll: "23KB1A0600", points: 1_800 },
      ],
      sections: [
        {
          label: "4 CSE C",
          points: 4_820,
          players: 9,
          // Only the number-one section carries its players.
          topPlayers: [
            { name: "Lakshmi", roll: "23KB1A0700", points: 1_240 },
            { name: "23KB1A0701", roll: "23KB1A0701", points: 1_100 },
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

  it("masks only the rolls whose owner hid the leaderboard", async () => {
    mocks.getHiddenRolls.mockResolvedValue(new Set(["23KB1A0599"]));

    const res = await request(createApp()).get("/api/games/board");

    // the hidden owner keeps the chosen name, but the roll is masked
    expect(res.body.players[0]).toEqual({
      name: "Asha",
      roll: "23KB1A0•••",
      points: 2_100,
    });
    // everyone else shows the full roll
    expect(res.body.players[1]).toEqual({
      name: "23KB1A0600",
      roll: "23KB1A0600",
      points: 1_800,
    });
  });

  it("asks which of the board's rolls are hidden", async () => {
    await request(createApp()).get("/api/games/board");

    expect(mocks.getHiddenRolls).toHaveBeenCalledWith([
      "23KB1A0599",
      "23KB1A0600",
      "23KB1A0700",
      "23KB1A0701",
    ]);
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
