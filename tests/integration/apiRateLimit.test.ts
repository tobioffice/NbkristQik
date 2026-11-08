import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import request from "supertest";

/**
 * Real HTTP against the app, with the real limiters. Two accounts behind one
 * address must not share the 600-request budget; anonymous abuse still hits
 * the per-address limit.
 *
 * `app.listen` once instead of `request(app)` per call: a fresh ephemeral
 * server per request would make the flood cases needlessly slow.
 */
vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
}));

const { app } = await import("../../src/api/server.js");

let server: Server;

beforeAll(() => {
  server = app.listen(0);
});

afterAll(() => {
  server.close();
});

const get = (path: string) => request(server).get(path);

const USER_A = "880001";
const USER_B = "880002";
const USER_C = "880003";
const PER_USER_LIMIT = 600;

describe("per-user API rate limits", () => {
  it(
    "does not share one budget between two users behind one IP",
    { timeout: 60_000 },
    async () => {
      for (let i = 0; i < PER_USER_LIMIT; i++) {
        const res = await get(`/api/config?userId=${USER_A}`);
        expect(res.status).toBe(200);
      }

      const blocked = await get(`/api/config?userId=${USER_A}`);
      expect(blocked.status).toBe(429);
      expect(blocked.headers["retry-after"]).toBeDefined();

      // same campus address, different account: their own budget is untouched
      const other = await get(`/api/config?userId=${USER_B}`);
      expect(other.status).toBe(200);
    },
  );

  it("/api/me is not blocked by another user's usage", async () => {
    // A is still over the 600 budget from the previous case
    const blocked = await get(`/api/me?userId=${USER_A}`);
    expect(blocked.status).toBe(429);

    const other = await get(`/api/me?userId=${USER_C}`);
    expect(other.status).not.toBe(429);
  });

  it("still limits anonymous callers per IP", { timeout: 60_000 }, async () => {
    for (let i = 0; i < PER_USER_LIMIT; i++) {
      const res = await get("/api/config");
      expect(res.status).toBe(200);
    }

    const blocked = await get("/api/config");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });
});
