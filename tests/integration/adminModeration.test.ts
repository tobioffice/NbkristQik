import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { createClient } from "@libsql/client";

// The panel reads these at route-registration time.
process.env.ADMIN_PANEL_PATH = "test-panel-chat";
process.env.ADMIN_PANEL_PASSWORD = "test-password";
// One regulated chat for the layer, so the route knows where to act.
process.env.MODERATION_CHAT_IDS = "-100123";

const client = createClient({ url: "file::memory:" });

const h = vi.hoisted(() => {
  const api = {
    getMe: vi.fn(),
    getChat: vi.fn(),
    getChatMemberCount: vi.fn(),
    getChatMember: vi.fn(),
    banChatMember: vi.fn(),
    unbanChatMember: vi.fn(),
    restrictChatMember: vi.fn(),
    deleteMessages: vi.fn(),
    deleteMessage: vi.fn(),
  };
  return { api };
});

vi.mock("../../src/db/db.js", () => ({
  turso: client,
  configureDatabase: async () => undefined,
  isEmbeddedDatabase: true,
  databaseUrl: "file::memory:",
}));
vi.mock("../../src/bot/bot.js", () => ({
  bot: { api: h.api, botInfo: { id: 999 } },
}));

const { app } = await import("../../src/api/server.js");
const { initDatabase } = await import("../../src/db/init.js");
const { tokenHash } = await import("../../src/api/admin/auth.js");

const BASE = "/test-panel-chat";
const PASSWORD = "test-password";
const TOKEN = crypto.randomBytes(32).toString("hex");
beforeAll(async () => {
  await initDatabase();
  await client.execute({
    sql: `INSERT INTO admin_sessions (token_hash, expires_at)
          VALUES (?, datetime('now', '+1 hour'))`,
    args: [tokenHash(TOKEN, PASSWORD)],
  });

  h.api.getMe.mockResolvedValue({ id: 999 });
  h.api.getChat.mockResolvedValue({
    id: -100123,
    title: "Test group",
    type: "supergroup",
    username: "test_chat",
  });
  h.api.getChatMemberCount.mockResolvedValue(42);
  h.api.getChatMember.mockResolvedValue({
    status: "administrator",
    can_delete_messages: true,
    can_restrict_members: true,
    user: { id: 999 },
  });
  h.api.banChatMember.mockResolvedValue(true);
  h.api.unbanChatMember.mockResolvedValue(true);
  h.api.restrictChatMember.mockResolvedValue(true);
  h.api.deleteMessages.mockResolvedValue(true);
  h.api.deleteMessage.mockResolvedValue(true);
});

const getJson = async () => {
  const res = await request(app)
    .get(`${BASE}/api/moderation`)
    .set("Cookie", `qik_admin=${TOKEN}`);
  return res;
};

describe("admin chat regulation endpoints", () => {
  it("serves the Chat view in the panel document", async () => {
    const shell = await request(app).get(BASE);
    expect(shell.text).toContain('id="view-chat"');
    expect(shell.text).toContain('data-view="chat"');
  });

  it("requires the admin session", async () => {
    const res = await request(app)
      .get(`${BASE}/api/moderation`)
      .set("Cookie", "");
    expect(res.status).toBe(401);
  });

  it("returns the rule, the words, the chat status and the counts", async () => {
    const res = await getJson();
    expect(res.status).toBe(200);

    expect(res.body.settings.enabled).toBe(true);
    expect(res.body.settings.muteSeconds).toBe(900);
    expect(res.body.chats[0]).toMatchObject({
      id: -100123,
      title: "Test group",
      memberCount: 42,
      bot: { isAdmin: true, canDelete: true, canRestrict: true },
    });
    expect(
      res.body.keywords.map((word: { phrase: string }) => word.phrase),
    ).toContain("sex");
    expect(res.body.counts).toMatchObject({ muted: 0, banned: 0 });
  });

  it("saves the rule and reads it back", async () => {
    const res = await request(app)
      .post(`${BASE}/api/moderation/settings`)
      .set("Cookie", `qik_admin=${TOKEN}`)
      .send({ autoMute: false, muteSeconds: 3600, notifyUser: false });

    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({
      autoMute: false,
      muteSeconds: 3600,
      notifyUser: false,
    });

    const reloaded = await getJson();
    expect(reloaded.body.settings.autoMute).toBe(false);
    expect(reloaded.body.settings.muteSeconds).toBe(3600);

    const nothing = await request(app)
      .post(`${BASE}/api/moderation/settings`)
      .set("Cookie", `qik_admin=${TOKEN}`)
      .send({});
    expect(nothing.status).toBe(400);
  });

  it("checks a message without touching anything", async () => {
    const res = await request(app)
      .post(`${BASE}/api/moderation/check`)
      .set("Cookie", `qik_admin=${TOKEN}`)
      .send({ text: "s e x" });

    expect(res.status).toBe(200);
    expect(res.body.hits).toContain("sex");
    expect(res.body.wouldAct).toBe(true);
  });

  it("adds, lists and removes a blocked word", async () => {
    const added = await request(app)
      .post(`${BASE}/api/moderation/keywords`)
      .set("Cookie", `qik_admin=${TOKEN}`)
      .send({ phrase: "custom bad" });
    expect(added.status).toBe(200);
    expect(added.body.created).toBe(true);
    const listed = added.body.keywords as { id: number; phrase: string }[];
    const row = listed.find((word) => word.phrase === "custom bad");
    expect(row).toBeTruthy();

    const duplicate = await request(app)
      .post(`${BASE}/api/moderation/keywords`)
      .set("Cookie", `qik_admin=${TOKEN}`)
      .send({ phrase: "custom bad" });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.created).toBe(false);

    const tooShort = await request(app)
      .post(`${BASE}/api/moderation/keywords`)
      .set("Cookie", `qik_admin=${TOKEN}`)
      .send({ phrase: "x" });
    expect(tooShort.status).toBe(400);

    const removed = await request(app)
      .delete(`${BASE}/api/moderation/keywords/${row?.id}`)
      .set("Cookie", `qik_admin=${TOKEN}`);
    expect(removed.status).toBe(200);

    const again = await request(app)
      .delete(`${BASE}/api/moderation/keywords/${row?.id}`)
      .set("Cookie", `qik_admin=${TOKEN}`);
    expect(again.status).toBe(404);
  });

  it("bans a user, purges their messages and lists the restriction", async () => {
    const res = await request(app)
      .post(`${BASE}/api/moderation/users/777/ban`)
      .set("Cookie", `qik_admin=${TOKEN}`)
      .send({ reason: "spam" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, action: "ban" });
    expect(h.api.banChatMember).toHaveBeenCalledWith({
      chat_id: -100123,
      user_id: 777,
      revoke_messages: true,
    });

    const listed = await getJson();
    expect(listed.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 777, state: "banned" }),
      ]),
    );
    expect(listed.body.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 777, action: "ban", actor: "panel" }),
      ]),
    );
    expect(listed.body.counts.banned).toBe(1);
  });

  it("mutes and unmutes, and rejects an unknown action or id", async () => {
    const muted = await request(app)
      .post(`${BASE}/api/moderation/users/888/mute`)
      .set("Cookie", `qik_admin=${TOKEN}`)
      .send({ seconds: 120 });
    expect(muted.status).toBe(200);
    expect(h.api.restrictChatMember).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: -100123,
        user_id: 888,
        until_date: expect.any(Number),
      }),
    );

    const unmuted = await request(app)
      .post(`${BASE}/api/moderation/users/888/unmute`)
      .set("Cookie", `qik_admin=${TOKEN}`)
      .send({});
    expect(unmuted.status).toBe(200);

    const badAction = await request(app)
      .post(`${BASE}/api/moderation/users/888/explode`)
      .set("Cookie", `qik_admin=${TOKEN}`)
      .send({});
    expect(badAction.status).toBe(400);

    const badId = await request(app)
      .post(`${BASE}/api/moderation/users/abc/ban`)
      .set("Cookie", `qik_admin=${TOKEN}`)
      .send({});
    expect(badId.status).toBe(400);
  });

  it("reports a Telegram refusal as a readable 400", async () => {
    h.api.banChatMember.mockRejectedValueOnce(
      new Error(
        "Bad Request: not enough rights to restrict/unrestrict chat member",
      ),
    );

    const res = await request(app)
      .post(`${BASE}/api/moderation/users/999/ban`)
      .set("Cookie", `qik_admin=${TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/admin with delete and restrict/);
  });
});
