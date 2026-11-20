import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";
import { createClient } from "@libsql/client";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.ADMIN_PANEL_PATH = "papers-test";
process.env.ADMIN_PANEL_PASSWORD = "panel-pass";

// Paper pages live on disk, never in the repo. Point the service at a
// throwaway directory before the server module starts handling requests.
const papersDir = await mkdtemp(path.join(os.tmpdir(), "qik-paper-files-"));
process.env.PAPER_FILES_DIR = papersDir;

const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
  })),
}));

vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
  trackMessage: vi.fn(),
}));

const { app } = await import("../../src/api/server.js");

const USER = "1000000002";
const PASSWORD = "panel-pass";
const BASE = "/papers-test";
const cookie = `qik_admin=${encodeURIComponent("test-admin-token")}`;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** A PNG chunk with an intentionally unchecked CRC (the service does not decode). */
const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([
    length,
    Buffer.from(type, "ascii"),
    data,
    Buffer.alloc(4),
  ]);
};

const PNG = Buffer.concat([
  PNG_SIGNATURE,
  pngChunk("IHDR", Buffer.alloc(13)),
  pngChunk("tEXt", Buffer.from("GPS=12.9,77.5")),
  pngChunk("IDAT", Buffer.from("pixels")),
  pngChunk("IEND", Buffer.alloc(0)),
]);

const upload = (fields: { subject?: string; exam?: string; note?: string }) => {
  const req = request(app)
    .post(`/api/papers?userId=${USER}`)
    .field("subject", fields.subject ?? "DBMS")
    .field("exam", fields.exam ?? "Mid 1, 2026");
  if (fields.note !== undefined) req.field("note", fields.note);
  return req
    .attach("images", PNG, {
      filename: "paper.png",
      contentType: "image/png",
    })
    .attach("images", PNG, {
      filename: "page-2.png",
      contentType: "image/png",
    });
};

beforeAll(async () => {
  await client.batch(
    [
      `CREATE TABLE question_papers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        exam TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE question_paper_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id INTEGER NOT NULL,
        file_name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE botusers (user_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT,
         first_seen TEXT, last_seen TEXT, private_actions INTEGER DEFAULT 0,
         channel_actions INTEGER DEFAULT 0, group_actions INTEGER DEFAULT 0,
         total_actions INTEGER DEFAULT 0)`,
      `INSERT INTO botusers (user_id, username, first_name) VALUES (${USER}, 'paper_user', 'Paper User')`,
      `CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, created_at TEXT, expires_at TEXT)`,
      `CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
         chat_type TEXT NOT NULL, action TEXT NOT NULL, detail TEXT,
         created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    ],
    "write",
  );

  await client.execute({
    sql: `INSERT INTO admin_sessions (token_hash, expires_at)
          VALUES (?, datetime('now', '+1 hour'))`,
    args: [
      crypto
        .createHmac("sha256", PASSWORD)
        .update("test-admin-token")
        .digest("hex"),
    ],
  });
});

afterAll(async () => {
  await rm(papersDir, { recursive: true, force: true });
});

describe("question-paper intake", () => {
  it("rejects an unauthenticated upload", async () => {
    const res = await request(app)
      .post("/api/papers")
      .field("subject", "DBMS")
      .field("exam", "Mid 1, 2026")
      .attach("images", PNG, {
        filename: "paper.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("rejects a non-image and a missing subject", async () => {
    const text = await request(app)
      .post(`/api/papers?userId=${USER}`)
      .field("subject", "DBMS")
      .field("exam", "Mid 1, 2026")
      .attach("images", Buffer.from("not an image"), {
        filename: "paper.txt",
        contentType: "text/plain",
      });
    expect(text.status).toBe(400);

    const noSubject = await request(app)
      .post(`/api/papers?userId=${USER}`)
      .field("subject", "")
      .field("exam", "Mid 1, 2026")
      .attach("images", PNG, {
        filename: "paper.png",
        contentType: "image/png",
      });
    expect(noSubject.status).toBe(400);
  });

  it("stores a valid paper, strips metadata, and keeps it private", async () => {
    const res = await upload({
      subject: "DBMS",
      exam: "Mid 1, 2026",
      note: "R20 regulation",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, pageCount: 2 });
    expect(res.body.id).toBeGreaterThan(0);

    const saved = await client.execute(
      `SELECT subject, exam, note FROM question_papers WHERE id = ?`,
      [res.body.id],
    );
    expect(saved.rows[0]).toMatchObject({
      subject: "DBMS",
      exam: "Mid 1, 2026",
      note: "R20 regulation",
    });

    const images = await client.execute(
      `SELECT file_name, mime_type, byte_size, position
       FROM question_paper_images WHERE paper_id = ? ORDER BY position`,
      [res.body.id],
    );
    expect(images.rows).toHaveLength(2);
    expect(images.rows[0].mime_type).toBe("image/png");
    expect(images.rows[0].position).toBe(0);
    expect(images.rows[1].position).toBe(1);

    const fileName = String(images.rows[0].file_name);
    const bytes = await readFile(path.join(papersDir, fileName));
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    // the GPS text chunk was removed before the file was stored
    expect(bytes.includes(Buffer.from("GPS=12.9,77.5"))).toBe(false);
    expect(bytes.length).toBe(Number(images.rows[0].byte_size));

    // There is no public image route: only the admin session can read it.
    const publicRead = await request(app).get(`/api/paper-image/${fileName}`);
    expect(publicRead.status).toBe(404);
  });

  it("lists the collection only behind the admin session", async () => {
    const unauthorized = await request(app).get(`${BASE}/api/papers`);
    expect(unauthorized.status).toBe(401);

    const list = await request(app)
      .get(`${BASE}/api/papers`)
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.papers).toHaveLength(1);
    expect(list.body.papers[0]).toMatchObject({
      subject: "DBMS",
      exam: "Mid 1, 2026",
      pageCount: 2,
      userId: Number(USER),
      name: "Paper User",
    });
    expect(list.body.papers[0].images).toHaveLength(2);
    for (const url of list.body.papers[0].images) {
      expect(url).toMatch(
        new RegExp(`^${BASE}/api/paper-images/[a-f0-9]{32}\\.png$`),
      );
    }

    const imageUnauthorized = await request(app).get(
      list.body.papers[0].images[0],
    );
    expect(imageUnauthorized.status).toBe(401);

    const image = await request(app)
      .get(list.body.papers[0].images[0])
      .set("Cookie", cookie);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toMatch(/image\/png/);
    expect(image.headers["x-content-type-options"]).toBe("nosniff");
    expect(image.headers["cache-control"]).toBe("private, max-age=300");
  });

  it("removes a paper and every page file from the admin list", async () => {
    const list = await request(app)
      .get(`${BASE}/api/papers`)
      .set("Cookie", cookie);
    const id = list.body.papers[0].id as number;

    const before = await readdir(papersDir);
    expect(before.filter((name) => !name.startsWith(".upload-"))).toHaveLength(
      2,
    );

    const removed = await request(app)
      .delete(`${BASE}/api/papers/${id}`)
      .set("Cookie", cookie);
    expect(removed.status).toBe(200);

    const after = await readdir(papersDir);
    expect(after.filter((name) => !name.startsWith(".upload-"))).toHaveLength(
      0,
    );

    const rows = await client.execute(
      `SELECT COUNT(*) AS n FROM question_papers`,
    );
    expect(Number(rows.rows[0].n)).toBe(0);

    const missing = await request(app)
      .delete(`${BASE}/api/papers/${id}`)
      .set("Cookie", cookie);
    expect(missing.status).toBe(404);
  });
});
