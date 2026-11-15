import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const { app } = await import("../../src/api/server.js");
const { initUserSettingsTable, getUserTheme } =
  await import("../../src/db/userSettings.model.js");

beforeAll(async () => {
  await initUserSettingsTable();
});

describe("POST /api/theme", () => {
  it("stores the caller's chat palette", async () => {
    const res = await request(app)
      .post("/api/theme?userId=4242")
      .send({ bgColor: "#ffffff", colorScheme: "light" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(await getUserTheme(4242)).toEqual({
      bgColor: "#ffffff",
      colorScheme: "light",
    });
  });

  it("rejects a colour that is not #rrggbb", async () => {
    const res = await request(app)
      .post("/api/theme?userId=4243")
      .send({ bgColor: "white", colorScheme: "light" });

    expect(res.status).toBe(400);
  });

  it("requires a Telegram identity", async () => {
    const res = await request(app)
      .post("/api/theme")
      .send({ bgColor: "#ffffff", colorScheme: "light" });

    expect(res.status).toBe(401);
  });
});
