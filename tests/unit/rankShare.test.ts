import { describe, it, expect, vi, beforeEach } from "vitest";

const getRegistration = vi.fn();
const getStudentRank = vi.fn();
const savePreparedInlineMessage = vi.fn(
  async (_params: {
    user_id: number;
    allow_group_chats?: boolean;
    result: { input_message_content: { message_text?: string } };
  }) => ({
    id: "prepared-1",
    expiration_date: 1_900_000_000,
  }),
);

vi.mock("../../src/db/registration.model.js", () => ({ getRegistration }));
vi.mock("../../src/db/student_stats.model.js", () => ({ getStudentRank }));
vi.mock("../../src/bot/bot.js", () => ({
  bot: { api: { savePreparedInlineMessage } },
}));

const { buildRankShare, prepareRankShare } =
  await import("../../src/services/rankShare.js");

/** The text of an article card; the other content kinds have no message_text. */
const messageText = (card: ReturnType<typeof buildRankShare>): string => {
  const content = card.input_message_content;
  if (!("message_text" in content)) throw new Error("not a text card");
  return content.message_text;
};

const registration = {
  user_id: "42",
  roll_no: "25KB1A05AR",
  display_name: null,
  registered_at: "2026-01-01",
  updated_at: "2026-01-01",
};

beforeEach(() => {
  getRegistration.mockReset();
  getStudentRank.mockReset();
  savePreparedInlineMessage.mockClear();
});

describe("a shareable rank card", () => {
  it("prints the roll, rank and score without a name", () => {
    const card = buildRankShare({
      roll: "25KB1A05AR",
      sort: "attendance",
      rank: 12,
      total: 340,
      value: 88.1,
    });

    expect(card.type).toBe("article");
    expect(messageText(card)).toContain("25KB1A05AR");
    expect(messageText(card)).toContain("#12");
    expect(messageText(card)).toContain("88.10%");
    expect(messageText(card)).not.toContain("ASHA");
    expect(card.reply_markup?.inline_keyboard[0][0].url).toBe(
      "https://t.me/NbkristQik_bot?startapp=rank",
    );
  });

  it("omits the score when the rank has no figure", () => {
    const card = buildRankShare({
      roll: "25KB1A05AR",
      sort: "attendance",
      rank: 12,
      total: 340,
      value: null,
    });

    expect(card.description).toBe("#12 of 340");
    expect(messageText(card)).toContain("#12");
    expect(messageText(card)).not.toContain("%");
  });

  it("reads as a mid-mark card when that is what was shared", () => {
    const card = buildRankShare({
      roll: "25KB1A05AR",
      sort: "midmarks",
      rank: 7,
      total: 320,
      value: 24.5,
    });

    expect(card.title).toContain("mid-mark");
    expect(messageText(card)).toContain("24.5");
  });
});

describe("preparing a rank share", () => {
  it("stores the card for the caller, not for a chat", async () => {
    getRegistration.mockResolvedValue(registration);
    getStudentRank.mockResolvedValue({ rank: 12, total: 340, value: 88.1 });

    const prepared = await prepareRankShare(42, "attendance");

    expect(prepared).toEqual({
      ok: true,
      share: { id: "prepared-1", expiresAt: 1_900_000_000 },
    });
    expect(savePreparedInlineMessage).toHaveBeenCalledTimes(1);
    const params = savePreparedInlineMessage.mock.calls[0]?.[0] as {
      user_id: number;
      allow_group_chats?: boolean;
      result: { input_message_content: { message_text?: string } };
    };
    expect(params.user_id).toBe(42);
    expect(params.allow_group_chats).toBe(true);
    expect(params.result.input_message_content.message_text).toContain("#12");
  });

  it("asks for a roll before sharing", async () => {
    getRegistration.mockResolvedValue(null);

    const prepared = await prepareRankShare(42, "attendance");

    expect(prepared).toMatchObject({ ok: false, status: 400 });
    expect(savePreparedInlineMessage).not.toHaveBeenCalled();
  });

  it("says there is no rank before there is a figure", async () => {
    getRegistration.mockResolvedValue(registration);
    getStudentRank.mockResolvedValue(null);

    const prepared = await prepareRankShare(42, "attendance");

    expect(prepared).toMatchObject({ ok: false, status: 404 });
    expect(savePreparedInlineMessage).not.toHaveBeenCalled();
  });
});
