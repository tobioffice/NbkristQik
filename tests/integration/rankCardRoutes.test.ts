import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const sendPhoto = vi.fn(
  async (_params: { chat_id: number; caption?: string }) => ({
    message_id: 1,
  }),
);
const savePreparedInlineMessage = vi.fn(
  async (_params: {
    user_id: number;
    result: { type: string; photo_url?: string };
  }) => ({
    id: "prepared-1",
    expiration_date: 1_900_000_000,
  }),
);

vi.mock("../../src/db/student_stats.model.js", () => ({
  getLeaderboard: vi.fn(async () => ({ rows: [], total: 0 })),
  getLeaderboardCoverage: vi.fn(async () => 0),
  getStudentRank: vi.fn(async () => ({ rank: 1, total: 1, value: 90 })),
  getStudentRanks: vi.fn(async () => ({
    attendance: null,
    midmarks: null,
    section: null,
  })),
  getLeaderboardFacets: vi.fn(async () => []),
  getLastSyncAt: vi.fn(async () => ({ newest: null, oldest: null })),
  yearDigit: vi.fn((value: unknown) => {
    const match = String(value ?? "")
      .trim()
      .match(/^([1-4])/);
    return match ? match[1] : null;
  }),
  getUptimeSummary: vi.fn(async () => []),
  getUptimeDailyBuckets: vi.fn(async () => []),
  recordHeartbeatAt: vi.fn(async () => undefined),
  recordHeartbeatsAt: vi.fn(async () => undefined),
}));

vi.mock("../../src/db/student.model.js", () => ({
  getTgUserRoll: vi.fn(async () => null),
  deleteTgUser: vi.fn(async () => undefined),
  getStudent: vi.fn(async () => null),
  findSimilarRolls: vi.fn(async () => []),
}));

vi.mock("../../src/db/registration.model.js", () => ({
  getRegistration: vi.fn(async (userId: string) =>
    userId === "101" || userId === "303"
      ? {
          userId,
          roll_no: userId === "101" ? "25KB1A05AR" : "25KB1A05AZ",
          display_name: null,
          registered_at: "2026-01-01",
          updated_at: "2026-01-01",
        }
      : null,
  ),
  getRegistrationByRoll: vi.fn(async () => null),
  upsertRegistration: vi.fn(async () => undefined),
  RollAlreadyRegisteredError: class RollAlreadyRegisteredError extends Error {},
}));

vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
  })),
}));

vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn(async () => ({
    roll_no: "25KB1A05AR",
    name: "A",
    section: "A",
    branch: "5",
    year: "31",
  })),
}));

vi.mock("../../src/services/tracker.js", () => ({ trackActivity: vi.fn() }));

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    api: { sendPhoto, savePreparedInlineMessage },
  },
}));

const { app } = await import("../../src/api/server.js");
const { clearRankCardStore } =
  await import("../../src/services/rankCardStore.js");
const { getStudentRanks } = await import("../../src/db/student_stats.model.js");

const jpeg = (size = 64): Buffer => {
  const bytes = Buffer.alloc(size, 7);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return bytes;
};

const upload = (userId = "101") =>
  request(app)
    .post(`/api/rank/card?userId=${userId}`)
    .set("Content-Type", "image/jpeg")
    .send(jpeg());

afterEach(() => {
  clearRankCardStore();
  sendPhoto.mockClear();
  savePreparedInlineMessage.mockClear();
});

describe("GET /api/me", () => {
  it("returns the caller's section ranks from the same scan", async () => {
    vi.mocked(getStudentRanks).mockResolvedValueOnce({
      attendance: { rank: 12, total: 245, value: 95.5 },
      midmarks: { rank: 30, total: 245, value: 18.8 },
      section: {
        year: "3",
        branch: "5",
        section: "A",
        attendance: { rank: 4, total: 63, value: 95.5 },
        midmarks: { rank: 7, total: 63, value: 18.8 },
      },
    });

    const res = await request(app).get("/api/me?userId=101");

    expect(res.status).toBe(200);
    expect(res.body.section).toEqual({
      year: "3",
      branch: "5",
      section: "A",
      attendance: { rank: 4, total: 63, value: 95.5 },
      midmarks: { rank: 7, total: 63, value: 18.8 },
    });
  });
});

describe("rank card upload", () => {
  it("needs a verified identity", async () => {
    const res = await request(app)
      .post("/api/rank/card")
      .set("Content-Type", "image/jpeg")
      .send(jpeg());

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("rejects anything that is not a JPEG", async () => {
    const res = await request(app)
      .post("/api/rank/card?userId=101")
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from("not an image"));

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/JPEG/);
  });

  it("serves the card from an unguessable URL with no sniffing", async () => {
    const uploaded = await upload();
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.ok).toBe(true);

    const path = new URL(uploaded.body.url).pathname;
    const image = await request(app).get(path);

    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toBe("image/jpeg");
    expect(image.headers["x-content-type-options"]).toBe("nosniff");
    expect(image.headers["x-robots-tag"]).toBe("noindex");
    expect(image.body.length).toBe(64);
  });

  it("marks the download variant as an attachment for Telegram Web", async () => {
    const uploaded = await upload();
    const path = new URL(uploaded.body.url).pathname;

    const image = await request(app).get(`${path}?download=1`);

    expect(image.headers["content-disposition"]).toContain("attachment");
    expect(image.headers["access-control-allow-origin"]).toBe(
      "https://web.telegram.org",
    );
  });

  it("replaces the previous card, so an old URL dies", async () => {
    const first = await upload();
    const second = await upload();

    expect(first.body.id).not.toBe(second.body.id);
    const oldPath = new URL(first.body.url).pathname;
    const oldImage = await request(app).get(oldPath);
    expect(oldImage.status).toBe(404);
  });

  it("answers 404 for a token that was never issued", async () => {
    const res = await request(app).get("/api/rank/card/not-a-real-token.jpg");
    expect(res.status).toBe(404);
  });
});

describe("save the card to the caller's chat", () => {
  it("sends the photo only to the caller", async () => {
    const uploaded = await upload();
    const res = await request(app)
      .post("/api/rank/card/send?userId=101")
      .send({ cardId: uploaded.body.id });

    expect(res.status).toBe(200);
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    const params = sendPhoto.mock.calls[0]?.[0] as {
      chat_id: number;
      caption?: string;
    };
    expect(params.chat_id).toBe(101);
    expect(params.caption).toMatch(/Long-press/);
  });

  it("refuses another account's card", async () => {
    const uploaded = await upload();
    const res = await request(app)
      .post("/api/rank/card/send?userId=202")
      .send({ cardId: uploaded.body.id });

    expect(res.status).toBe(404);
    expect(sendPhoto).not.toHaveBeenCalled();
  });
});

describe("share with a card", () => {
  it("uses the card only when it belongs to the caller", async () => {
    const uploaded = await upload("101");

    const own = await request(app).post("/api/rank/share?userId=101").send({
      sort: "attendance",
      scope: "section",
      cardId: uploaded.body.id,
    });
    expect(own.status).toBe(200);

    const other = await request(app).post("/api/rank/share?userId=303").send({
      sort: "attendance",
      scope: "section",
      cardId: uploaded.body.id,
    });
    expect(other.status).toBe(200);
    const last = savePreparedInlineMessage.mock.calls.at(-1)?.[0] as {
      result: { type: string; photo_url?: string };
    };
    // Someone else's token is not a card for this caller: the message falls
    // back to the text article rather than shipping a stranger's image.
    expect(last.result.type).toBe("article");
    expect(last.result.photo_url).toBeUndefined();
  });
});
