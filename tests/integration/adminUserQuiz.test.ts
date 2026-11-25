import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { createClient } from "@libsql/client";

process.env.ADMIN_PANEL_PATH = "test-panel-quiz";
process.env.ADMIN_PANEL_PASSWORD = "test-password";

/**
 * The student drawer's quiz history: every attempt, every question, the chosen
 * option, whether it was right, the time it took and what it paid. One route,
 * real in-memory SQLite, minted admin session.
 */
const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({
  turso: client,
  configureDatabase: async () => undefined,
  isEmbeddedDatabase: true,
  databaseUrl: "file::memory:",
}));
vi.mock("../../src/bot/bot.js", () => ({
  bot: { api: {}, botInfo: { id: 999 } },
}));

const { app } = await import("../../src/api/server.js");
const { initDatabase } = await import("../../src/db/init.js");
const { tokenHash } = await import("../../src/api/admin/auth.js");

const BASE = "/test-panel-quiz";
const PASSWORD = "test-password";
const TOKEN = crypto.randomBytes(32).toString("hex");
const cookie = `qik_admin=${TOKEN}`;

const q1 = { id: 0, prompt: "", options: [] as string[], correct: 0 };
const q2 = { id: 0, prompt: "", options: [] as string[], correct: 0 };

beforeAll(async () => {
  await initDatabase();
  await client.execute({
    sql: `INSERT INTO admin_sessions (token_hash, expires_at)
          VALUES (?, datetime('now', '+1 hour'))`,
    args: [tokenHash(TOKEN, PASSWORD)],
  });

  const rows = (
    await client.execute(
      "SELECT id, prompt, options, correct FROM game_questions ORDER BY id LIMIT 2",
    )
  ).rows;
  const fill = (target: typeof q1, row: Record<string, unknown>) => {
    target.id = Number(row.id);
    target.prompt = String(row.prompt);
    target.options = JSON.parse(String(row.options)) as string[];
    target.correct = Number(row.correct);
  };
  fill(q1, rows[0]);
  fill(q2, rows[1]);

  const insert = async (attempt: {
    game: "five" | "duel";
    roundKey: string;
    userId: number;
    answers: unknown[];
    idx: number;
    score: number;
    points: number;
    status: "active" | "done";
    startedAt: string;
    finishedAt: string | null;
  }) =>
    client.execute({
      sql: `INSERT INTO game_attempts
              (game, round_key, day_key, week_key, season, user_id, roll_no,
               section_key, section_label, question_ids, answers, idx, score,
               points, streak, duel_id, status, started_at, shown_at, finished_at)
            VALUES (?, ?, '2026-11-25', '2026-W48', 'S1', ?, '26KB105555',
                    '2|CSE|I', '2 CSE I', ?, ?, ?, ?, ?, 7, NULL, ?, ?, ?, ?)`,
      args: [
        attempt.game,
        attempt.roundKey,
        attempt.userId,
        JSON.stringify([q1.id, q2.id]),
        JSON.stringify(attempt.answers),
        attempt.idx,
        attempt.score,
        attempt.points,
        attempt.status,
        attempt.startedAt,
        attempt.startedAt,
        attempt.finishedAt,
      ],
    });

  // A completed daily run with one right and one slow wrong answer.
  await insert({
    game: "five",
    roundKey: "five-2026-11-25",
    userId: 555,
    answers: [
      { option: q1.correct, correct: true, ms: 4000, points: 150 },
      { option: (q2.correct + 1) % 4, correct: false, ms: 12000, points: 0 },
    ],
    idx: 2,
    score: 1200,
    points: 1300,
    status: "done",
    startedAt: "2026-11-25T10:00:00.000Z",
    finishedAt: "2026-11-25T10:10:00.000Z",
  });

  // A duel still on its second question; only the first is answered.
  await insert({
    game: "duel",
    roundKey: "d99",
    userId: 555,
    answers: [{ option: q1.correct, correct: true, ms: 2500, points: 150 }],
    idx: 1,
    score: 150,
    points: 0,
    status: "active",
    startedAt: "2026-11-25T11:00:00.000Z",
    finishedAt: null,
  });
});

const getQuiz = () =>
  request(app).get(`${BASE}/api/users/555/quiz`).set("Cookie", cookie);

describe("GET admin /api/users/:id/quiz", () => {
  it("refuses an unauthenticated caller", async () => {
    const res = await request(app).get(`${BASE}/api/users/555/quiz`);
    expect(res.status).toBe(401);
  });

  it("rejects a non-numeric id", async () => {
    const res = await request(app)
      .get(`${BASE}/api/users/abc/quiz`)
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("returns every attempt with summary and per-question detail", async () => {
    const res = await getQuiz();
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");

    expect(res.body.attemptTotal).toBe(2);
    expect(res.body.truncated).toBe(false);
    expect(res.body.summary).toEqual({
      attempts: 2,
      completed: 1,
      dailyRuns: 1,
      duels: 1,
      bestScore: 1200,
      bestPoints: 1300,
      correct: 2,
      answered: 3,
      accuracy: 66.7,
      avgMs: 6167,
    });

    const [active, done] = res.body.attempts;
    expect(active).toMatchObject({
      game: "duel",
      status: "active",
      questionCount: 2,
      answered: 1,
      correctCount: 1,
      // computed from the answers, not the stored 7
      streak: 1,
      durationMs: null,
      finishedAt: null,
    });
    expect(active.questions[0]).toMatchObject({
      index: 1,
      prompt: q1.prompt,
      correctIndex: q1.correct,
      chosenIndex: q1.correct,
      correct: true,
      ms: 2500,
      points: 150,
    });
    expect(active.questions[1]).toMatchObject({
      index: 2,
      prompt: q2.prompt,
      correctIndex: q2.correct,
      chosenIndex: null,
      correct: null,
      ms: null,
      points: null,
    });

    expect(done).toMatchObject({
      game: "five",
      status: "done",
      score: 1200,
      points: 1300,
      questionCount: 2,
      answered: 2,
      correctCount: 1,
      streak: 1,
      durationMs: 600_000,
    });
    expect(done.questions[0]).toMatchObject({
      chosenIndex: q1.correct,
      correct: true,
      correctIndex: q1.correct,
      ms: 4000,
      points: 150,
      options: q1.options,
    });
    expect(done.questions[1]).toMatchObject({
      chosenIndex: (q2.correct + 1) % 4,
      correct: false,
      correctIndex: q2.correct,
      ms: 12000,
      points: 0,
      prompt: q2.prompt,
    });
  });

  it("returns an empty history for an unknown account", async () => {
    const res = await request(app)
      .get(`${BASE}/api/users/999/quiz`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.attemptTotal).toBe(0);
    expect(res.body.attempts).toEqual([]);
    expect(res.body.summary).toMatchObject({
      attempts: 0,
      bestScore: 0,
      accuracy: 0,
      avgMs: null,
    });
  });
});
