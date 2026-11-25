import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createClient } from "@libsql/client";

process.env.ADMIN_PANEL_PATH = "test-panel-league";
process.env.ADMIN_PANEL_PASSWORD = "test-password-league";

/**
 * The admin League tab's endpoint: every scorer with roll, identity, section,
 * verification and privacy, plus the verified-only Section Wars board.
 *
 * Real in-memory SQLite; the admin session is minted through the login route.
 */
const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

const { app } = await import("../../src/api/server.js");
const { initGameTables } = await import("../../src/db/game.model.js");
const { istStamp } = await import("../../src/games/time.js");

const BASE = "/test-panel-league";
const PASSWORD = "test-password-league";
const stamp = istStamp();
let cookie = "";

beforeAll(async () => {
  await client.batch(
    [
      `CREATE TABLE admin_sessions (
        token_hash TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      )`,
      `CREATE TABLE roll_claims (
        roll_no TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        verified_at TEXT NOT NULL DEFAULT (datetime('now')),
        blocked INTEGER NOT NULL DEFAULT 0,
        hide_leaderboard INTEGER NOT NULL DEFAULT 0,
        block_lookups INTEGER NOT NULL DEFAULT 0,
        block_registration INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE botusers (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        private_actions INTEGER NOT NULL DEFAULT 0,
        channel_actions INTEGER NOT NULL DEFAULT 0,
        group_actions INTEGER NOT NULL DEFAULT 0,
        total_actions INTEGER NOT NULL DEFAULT 0
      )`,
    ],
    "write",
  );
  await initGameTables();

  const score = (
    userId: number,
    rollNo: string,
    points: number,
    sectionKey: string,
    sectionLabel: string,
  ) =>
    client.execute({
      sql: `INSERT INTO game_scores
              (season, week_key, day_key, user_id, roll_no, section_key,
               section_label, source, ref, points)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'five', ?, ?)`,
      args: [
        "S1",
        stamp.week,
        stamp.date,
        userId,
        rollNo,
        sectionKey,
        sectionLabel,
        `a${userId}`,
        points,
      ],
    });

  const player = (
    userId: number,
    rollNo: string,
    displayName: string | null,
    sectionKey: string,
    sectionLabel: string,
  ) =>
    client.execute({
      sql: `INSERT INTO game_players
              (user_id, roll_no, display_name, section_key, section_label)
            VALUES (?, ?, ?, ?, ?)`,
      args: [userId, rollNo, displayName, sectionKey, sectionLabel],
    });

  const run = (userId: number, rollNo: string, game = "five") =>
    client.execute({
      sql: `INSERT INTO game_attempts
              (game, round_key, day_key, week_key, season, user_id, roll_no,
               question_ids, idx, score, points, streak, status, started_at, finished_at)
            VALUES (?, ?, ?, ?, 'S1', ?, ?, '[]', 10, 400, 400, 0,
                    'done', datetime('now'), datetime('now'))`,
      args: [
        game,
        `${game}-${stamp.date}-${userId}`,
        stamp.date,
        stamp.week,
        userId,
        rollNo,
      ],
    });

  // 1: verified and hidden, in 3 CSE F. 2: unverified scorer, same section.
  // 3: unverified with no display name, in 2 CSE F.
  await player(1, "24KB1A05X0", "Reddy", "3|CSE|F", "3 CSE F");
  await player(2, "26KB104120", "Jasmitha", "3|CSE|F", "3 CSE F");
  await player(3, "23KB1A05E4", null, "2|CSE|F", "2 CSE F");
  await score(1, "24KB1A05X0", 840, "3|CSE|F", "3 CSE F");
  await score(2, "26KB104120", 895, "3|CSE|F", "3 CSE F");
  await score(3, "23KB1A05E4", 848, "2|CSE|F", "2 CSE F");
  await client.execute({
    sql: `INSERT INTO roll_claims
            (roll_no, user_id, email, hide_leaderboard)
          VALUES ('24KB1A05X0', '1', 'reddy@nbkrist.org', 1)`,
    args: [],
  });
  await client.execute({
    sql: `INSERT INTO botusers (user_id, username, first_name)
          VALUES (2, 'jasmin', 'Jasmitha'), (3, 'vishnu_k', 'Vishnu')`,
    args: [],
  });
  await run(1, "24KB1A05X0");
  await run(2, "26KB104120");

  // Two matches for the duel panel: one waiting for a friend, one settled.
  const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await client.execute({
    sql: `INSERT INTO game_duels
            (challenger_id, challenger_roll, challenger_name, challenger_score,
             challenger_attempt_id, question_ids, day_key, week_key, season,
             status, expires_at)
          VALUES (1, '24KB1A05X0', 'Reddy', 840, 55001, '[]', ?, ?, 'S1',
                  'open', ?)`,
    args: [stamp.date, stamp.week, inAnHour],
  });
  await client.execute({
    sql: `INSERT INTO game_duels
            (challenger_id, challenger_roll, challenger_name, challenger_score,
             challenger_attempt_id, question_ids, day_key, week_key, season,
             status, opponent_id, opponent_roll, opponent_name, opponent_score,
             winner_id, finished_at, expires_at)
          VALUES (2, '26KB104120', 'Jasmitha', 895, 55002, '[]', ?, ?, 'S1',
                  'done', 3, '23KB1A05E4', 'Vishnu', 848, 2,
                  datetime('now'), ?)`,
    args: [stamp.date, stamp.week, inAnHour],
  });

  // A duel attempt is a match, not a run: it must not raise a play count.
  await run(1, "24KB1A05X0", "duel");
  // A legacy duel award must not put a player on the board or move a section.
  await client.execute({
    sql: `INSERT INTO game_scores
            (season, week_key, day_key, user_id, roll_no, section_key,
             section_label, source, ref, points)
          VALUES ('S1', ?, ?, 4, '23KB1A05D4', '3|CSE|F', '3 CSE F', 'duel',
                  'd4', 500)`,
    args: [stamp.week, stamp.date],
  });

  const login = await request(app)
    .post(`${BASE}/login`)
    .send({ password: PASSWORD });
  cookie = (login.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
});

describe("GET admin /api/league", () => {
  it("refuses an unauthenticated caller", async () => {
    const res = await request(app).get(`${BASE}/api/league`);
    expect(res.status).toBe(401);
  });

  it("returns every scorer with identity and verification", async () => {
    const res = await request(app)
      .get(`${BASE}/api/league`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      season: "S1",
      week: stamp.week,
      stats: {
        players: 3,
        verified: 1,
        sections: 1,
        runsToday: 2,
        playersToday: 2,
      },
      playerTotal: 3,
    });

    const byRoll = Object.fromEntries(
      (res.body.players as { rollNo: string }[]).map((player) => [
        player.rollNo,
        player,
      ]),
    );
    // the admin sees the full roll even when the owner hid the board
    expect(byRoll["24KB1A05X0"]).toMatchObject({
      rollNo: "24KB1A05X0",
      displayName: "Reddy",
      sectionLabel: "3 CSE F",
      points: 840,
      plays: 1,
      verified: true,
      hidden: true,
    });
    expect(byRoll["26KB104120"]).toMatchObject({
      rollNo: "26KB104120",
      displayName: "Jasmitha",
      username: "jasmin",
      points: 895,
      plays: 1,
      verified: false,
      hidden: false,
    });
    expect(byRoll["23KB1A05E4"]).toMatchObject({
      rollNo: "23KB1A05E4",
      displayName: null,
      firstName: "Vishnu",
      sectionLabel: "2 CSE F",
      points: 848,
      plays: 0,
      verified: false,
    });
  });

  it("shows the duel queue and recent matches", async () => {
    const res = await request(app)
      .get(`${BASE}/api/league`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.duels.stats).toEqual({
      open: 1,
      finishedWeek: 1,
      expiredWeek: 0,
      today: 2,
      players: 3,
    });

    const recent = res.body.duels.recent as {
      status: string;
      winner: string | null;
      challenger: {
        userId: number;
        rollNo: string;
        name: string | null;
        score: number;
      };
      opponent: {
        userId: number;
        rollNo: string;
        name: string | null;
        score: number;
      } | null;
    }[];
    expect(recent).toHaveLength(2);

    const done = recent.find((duel) => duel.status === "done");
    expect(done).toMatchObject({
      winner: "challenger",
      challenger: {
        userId: 2,
        rollNo: "26KB104120",
        name: "Jasmitha",
        score: 895,
      },
      opponent: {
        userId: 3,
        rollNo: "23KB1A05E4",
        name: "Vishnu",
        score: 848,
      },
    });

    const open = recent.find((duel) => duel.status === "open");
    expect(open).toMatchObject({
      winner: null,
      challenger: {
        userId: 1,
        rollNo: "24KB1A05X0",
        name: "Reddy",
        score: 840,
      },
      opponent: null,
    });
  });

  it("shows the verified-only section board", async () => {
    const res = await request(app)
      .get(`${BASE}/api/league`)
      .set("Cookie", cookie);

    // only 3 CSE F has a verified scorer (840); 2 CSE F counts nobody
    expect(res.body.sections).toEqual([
      { label: "3 CSE F", points: 840, players: 1 },
    ]);
  });
});
